// app.js - Core Frontend Logica (Inschrijfsysteem met Animaties & Klas-integratie)

class App {
    constructor() {
        this.user = window.dbApi.getCurrentUser();
        if (!this.user) {
            window.location.href = 'login.html';
            return;
        }

        this.hotels = [];
        this.currentHotelId = null;
        this.roommateSearchQuery = {};
        this.selectedRoommates = {};
        
        // Nieuwe instelling voor groepsboekingen
        this.sta_groepjes_toe = true; 

        // TIMER STATE
        this._lockStartServerMs = null;
        this._timerActive = false;
        this._localStartTime = null; 

        this.init();
    }

    async init() {
        // --- SLIMME DATA-CHECK ---
        if (this.user && (!this.user.reis_naam || !this.user.school_naam)) {
            console.log("Data in sessie incompleet, database wordt geraadpleegd...");
            const { data: sData } = await window.dbApi.supabaseClient.from('school').select('naam, slug').eq('id', this.user.school_id).maybeSingle();
            const { data: rData } = await window.dbApi.supabaseClient.from('reis').select('naam, slug, sta_groepjes_toe, inschrijving_start, is_bevroren, type').eq('id', this.user.reis_id).maybeSingle();
            if(sData) this.user.school_naam = sData.naam;
            if(rData) {
                this.user.reis_naam = rData.naam;
                this.sta_groepjes_toe = rData.type === 'activiteit' ? false : (rData.sta_groepjes_toe !== false);
                this.reisData = rData;
            }
            localStorage.setItem('currentUser', JSON.stringify(this.user));
        } else {
            // Check toch even de groepjes-instelling als de sessie er al was
            const { data: rData } = await window.dbApi.supabaseClient.from('reis').select('sta_groepjes_toe, inschrijving_start, is_bevroren, type').eq('id', this.user.reis_id).maybeSingle();
            if(rData) {
                this.sta_groepjes_toe = rData.type === 'activiteit' ? false : (rData.sta_groepjes_toe !== false);
                this.reisData = rData;
            }
        }

        document.getElementById('userInfo').innerText = `${this.user.vnaam} ${this.user.naam}`;
        
        if (document.getElementById('navTitle')) document.getElementById('navTitle').innerText = this.user.reis_naam || 'Reservering';
        if (document.getElementById('schoolSubTitle')) document.getElementById('schoolSubTitle').innerText = this.user.school_naam || '';
        if (document.getElementById('pageTitle')) document.title = (this.user.reis_naam || 'Reserveringen') + " - Overzicht";

        await window.dbApi.initializeDB();
        await window.dbApi.syncServerTime();

        this.hotels = await window.dbApi.getHotels(true, this.user.reis_id);
        if (this.hotels.length > 0) {
            this.currentHotelId = this.hotels[0].id;
        }

        this.renderTabs();
        this.setHotel(this.currentHotelId);

        const channel = window.dbApi.supabaseClient
            .channel('realtime_reserveringen')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'reservering' }, payload => {
                this.render(); 
            })
            .subscribe();

        setInterval(async () => {
            await window.dbApi.checkTimeouts();
            
            // Haal de laatste freeze status op (optioneel, maar wel handig voor live updates)
            if (this.user && this.user.reis_id) {
                const { data: rData } = await window.dbApi.supabaseClient.from('reis').select('is_bevroren, inschrijving_start, type').eq('id', this.user.reis_id).maybeSingle();
                if (rData) {
                    if (!this.reisData) this.reisData = {};
                    this.reisData.is_bevroren = rData.is_bevroren;
                    this.reisData.inschrijving_start = rData.inschrijving_start;
                    this.reisData.type = rData.type;
                    if (rData.type === 'activiteit') this.sta_groepjes_toe = false;
                }
            }

            this.render(); 
        }, 5000);

        setInterval(() => {
            this._tickTimer();
        }, 1000);
    }

    _startTimer(serverTimestamp) {
        if (this._timerActive) return; 
        this._lockStartServerMs = serverTimestamp;
        this._localStartTime = Date.now(); 
        this._timerActive = true;
    }

    _stopTimer() {
        this._lockStartServerMs = null;
        this._localStartTime = null;
        this._timerActive = false;
    }

    _getRemaining() {
        if (!this._timerActive || !this._localStartTime) return -1;
        const elapsed = Math.floor((Date.now() - this._localStartTime) / 1000);
        return Math.max(0, 60 - elapsed);
    }

    _tickTimer() {
        if (!this._timerActive) return;

        const remaining = this._getRemaining();
        const display = document.getElementById('timerDisplay');

        if (display) {
            display.innerText = remaining + 's';
            if (remaining <= 10) {
                display.classList.add('text-red-600', 'bg-red-50');
                display.classList.remove('text-blue-700', 'bg-blue-50');
            }
        }

        if (remaining <= 0) {
            this._stopTimer();
            this.annuleer();
        }
    }

    renderTabs() {
        const container = document.getElementById('tabsContainer');
        if (!container) return;
        container.innerHTML = '';
        
        this.hotels.forEach(h => {
            const btn = document.createElement('button');
            btn.id = `tab-${h.id}`;
            btn.innerText = h.naam;
            btn.onclick = () => this.setHotel(h.id);
            container.appendChild(btn);
        });
    }

    updateTabStyles() {
        this.hotels.forEach(h => {
            const btn = document.getElementById(`tab-${h.id}`);
            if (btn) {
                if (h.id === this.currentHotelId) {
                    btn.className = "px-6 py-2 rounded-lg font-medium text-sm transition shadow-sm bg-white text-gray-800 border border-gray-200";
                } else {
                    btn.className = "px-6 py-2 rounded-lg font-medium text-sm transition text-gray-500 hover:text-gray-800 hover:bg-white/50";
                }
            }
        });
    }

    setHotel(hotelId) {
        if (!hotelId) return;
        this.currentHotelId = hotelId;
        
        const hotel = this.hotels.find(h => h.id === hotelId);
        if (hotel && hotel.bg_image) {
            document.body.style.backgroundImage = `url('${hotel.bg_image}')`;
        }

        this.updateTabStyles();
        this.render(true); 
    }

    // --- NIEUW: De Zwevende Bevestigings-Modal ---
    showConfirmModal(kamerNr, onConfirmCallback) {
        const modalId = 'confirmModal_' + Date.now();
        const isActiviteit = this.reisData && this.reisData.type === 'activiteit';
        const titleText = isActiviteit ? 'Inschrijving bevestigen?' : `Kamer ${kamerNr} bevestigen?`;
        const modalHtml = `
            <div id="${modalId}" class="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm opacity-0 transition-opacity duration-300">
                <div class="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 transform scale-95 transition-transform duration-300 mx-4">
                    <div class="w-12 h-12 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center mb-4 text-xl mx-auto">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                    </div>
                    <h3 class="text-xl font-bold text-center text-slate-800 mb-2">${titleText}</h3>
                    <p class="text-center text-slate-500 text-sm mb-6">Je keuze is definitief en kan later niet aangepast worden.</p>
                    <div class="flex gap-3">
                        <button id="btnCancel_${modalId}" class="flex-1 bg-white border border-slate-300 text-slate-700 font-medium py-2.5 rounded-xl hover:bg-slate-50 transition text-sm">Nee, terug</button>
                        <button id="btnYes_${modalId}" class="flex-1 bg-orange-500 text-white font-medium py-2.5 rounded-xl hover:bg-orange-600 transition shadow-md shadow-orange-500/20 text-sm">Ja, definitief bevestigen</button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        const modal = document.getElementById(modalId);
        
        setTimeout(() => {
            modal.classList.remove('opacity-0');
            modal.firstElementChild.classList.remove('scale-95');
        }, 10);

        document.getElementById(`btnCancel_${modalId}`).onclick = () => {
            modal.classList.add('opacity-0');
            modal.firstElementChild.classList.add('scale-95');
            setTimeout(() => modal.remove(), 300);
        };

        document.getElementById(`btnYes_${modalId}`).onclick = () => {
            modal.classList.add('opacity-0');
            modal.firstElementChild.classList.add('scale-95');
            setTimeout(() => modal.remove(), 300);
            onConfirmCallback();
        };
    }

    async render(force = false) {
        const isTyping = document.activeElement && document.activeElement.tagName === 'INPUT';
        if (isTyping && !force) return;

        if (!this.currentHotelId) return; 

        const overlay = document.getElementById('cardOverlay');
        const container = document.getElementById('kamersContainer');
        const kamers = await window.dbApi.getKamersMetStatus(this.currentHotelId, this.user.geslacht);

        // --- NIEUW: LOGICA VOOR BEVRIEZEN & STARTDATUM ---
        const serverTijd = window.dbApi.getEstimatedServerTime(); // Gecorrigeerde servertijd
        const reis = this.reisData || {};
        let inschrijvingGeopend = true;
        let isBevroren = !!reis.is_bevroren;

        if (reis.inschrijving_start) {
            inschrijvingGeopend = serverTijd >= new Date(reis.inschrijving_start).getTime();
        }
        
        const isReadOnly = isBevroren || !inschrijvingGeopend;

        if (isBevroren && !this._freezeAlertShown) {
            this.showAlert("De inschrijvingen zijn officieel gesloten door de beheerder. Je kunt de indeling alleen bekijken.", "info");
            this._freezeAlertShown = true;
            this._notOpenAlertShown = false; // Reset
        } else if (!isBevroren && !inschrijvingGeopend && !this._notOpenAlertShown) {
            this.showAlert(`De kamerindeling opent op ${new Date(reis.inschrijving_start).toLocaleString('nl-BE')}`, "info");
            this._notOpenAlertShown = true;
            this._freezeAlertShown = false; // Reset
        } else if (!isBevroren && inschrijvingGeopend) {
            this._notOpenAlertShown = false;
            this._freezeAlertShown = false;
        }

        let userRes = null;
        for (let kamer of kamers) {
            const res = kamer.reservaties.find(r => r.gebruikerid === this.user.id);
            if (res) userRes = res;
        }
        const hasPending = userRes && userRes.status === 'pending';
        const hasConfirmed = userRes && userRes.status === 'confirmed';

        const getAvatarStyle = (name) => {
            const colors = ['#3b82f6', '#10b981', '#6366f1', '#0ea5e9', '#14b8a6', '#64748b'];
            let hash = 0;
            for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
            const color = colors[Math.abs(hash) % colors.length];
            return `background-color: ${color}; color: white;`;
        };

        if (hasPending) {
            this._startTimer(userRes.timestamp);
            overlay.classList.remove('hidden');
            setTimeout(() => overlay.classList.remove('opacity-0'), 10);
        } else {
            if (this._timerActive) this._stopTimer();
            overlay.classList.add('opacity-0');
            setTimeout(() => overlay.classList.add('hidden'), 300);
            this.roommateSearchQuery = {};
            this.selectedRoommates = {};
        }

        const activeElementId = document.activeElement ? document.activeElement.id : null;
        container.innerHTML = '';

        kamers.forEach((kamer, index) => {
            const isFull = kamer.vrij <= 0;
            const isUserRoom = userRes && userRes.kamerid === kamer.id;
            const isThisPending = isUserRoom && userRes.status === 'pending';
            const lockedByOther = kamer.isLocked && !isUserRoom;

            const hInfo = this.hotels.find(x => x.id === kamer.hotelid);
            const hotelNaam = hInfo ? hInfo.naam : 'Onbekend';

            let cardClasses = `kamer-card bg-white rounded-xl p-5 border border-gray-200 relative overflow-visible shadow-sm `;

            if (isThisPending) {
                cardClasses = `fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[90%] max-w-md z-50 bg-white rounded-xl p-6 border border-blue-200 ring-4 ring-blue-50 shadow-2xl transition-all duration-300`;
            } else if (isUserRoom && userRes.status === 'confirmed') {
                cardClasses += `border-green-400 border-[1.5px] shadow-green-50 ring-2 ring-green-50`;
            } else if (lockedByOther) {
                cardClasses += `frozen-room opacity-60 pointer-events-none bg-gray-50`;
            }

            const card = document.createElement('div');
            card.className = cardClasses;
            
            if (!isThisPending) {
                card.style.animationDelay = `${index * 0.05}s`;
            }

            let timerHtml = '';
            if (isThisPending) {
                const rem = this._getRemaining();
                timerHtml = `<div class="bg-blue-50 text-blue-700 px-3 py-1 rounded-lg font-semibold font-mono border border-blue-100" id="timerDisplay">${rem >= 0 ? rem : 60}s</div>`;
            }

            let frozenOverlay = '';
            if (lockedByOther) {
                frozenOverlay = `
                    <div class="frozen-overlay absolute inset-0 bg-white/40 backdrop-blur-[1px] rounded-xl z-10 flex flex-col items-center justify-center gap-2 pointer-events-none">
                        <span class="text-xs font-medium text-gray-600 bg-white px-3 py-1.5 rounded-md border border-gray-200 shadow-sm">Plaats in bewerking...</span>
                    </div>`;
            }

            const fillPct = (kamer.bezet / kamer.capaciteit) * 100;
            const progressColor = isFull ? 'bg-red-500' : 'bg-blue-500';

            let headerHtml = `
                <div class="flex justify-between items-start mb-3">
                    <div>
                        <h3 class="text-lg font-bold text-gray-900 tracking-tight">${kamer.kamer_nr}</h3>
                        <p class="text-xs text-gray-500 mt-1 uppercase tracking-wider font-medium flex items-center gap-1">
                            <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clip-rule="evenodd"></path></svg>
                            ${hotelNaam}
                        </p>
                    </div>
                    ${timerHtml || `<span class="text-xs font-semibold px-2.5 py-1 rounded-md border ${isFull ? 'bg-red-50 text-red-600 border-red-100' : lockedByOther ? 'bg-gray-100 text-gray-500 border-gray-200' : 'bg-blue-50 text-blue-600 border-blue-100'}">
                        ${lockedByOther ? '🔒' : kamer.bezet + ' / ' + kamer.capaciteit}
                    </span>`}
                </div>
                <div class="w-full bg-gray-100 rounded-full h-1.5 mb-5 overflow-hidden">
                    <div class="${progressColor} h-1.5 rounded-full transition-all duration-500" style="width: ${fillPct}%"></div>
                </div>
            `;

            let lijstHtml = '<ul class="space-y-2 mb-6 min-h-[80px] relative">';
            kamer.reservaties.forEach(r => {
                const isMe = r.gebruiker.id === this.user.id;
                let statusBadge = r.status === 'confirmed' ? '<svg class="w-4 h-4 text-green-500 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>' : '';
                
                // NIEUW: De klas ophalen als we die hebben
                const klasTxt = r.gebruiker.klas && r.gebruiker.klas !== 'null' ? r.gebruiker.klas : '-';

                lijstHtml += `
                    <li class="flex items-center text-sm ${isMe ? 'font-semibold text-blue-900 bg-blue-50 p-2 rounded-lg border border-blue-100' : 'text-gray-700 p-2 bg-gray-50 rounded-lg border border-gray-100'}">
                        <div class="w-7 h-7 rounded-full flex items-center justify-center mr-3 text-xs font-semibold" style="${getAvatarStyle(r.gebruiker.vnaam)}">
                            ${r.gebruiker.vnaam.charAt(0)}${r.gebruiker.naam.charAt(0)}
                        </div>
                        ${r.gebruiker.vnaam} ${r.gebruiker.naam} <span class="text-xs text-gray-400 ml-1 font-normal">(${klasTxt})</span> ${isMe && isThisPending ? '<span class="ml-2 text-xs text-blue-500">(Jij)</span>' : statusBadge}
                    </li>
                `;
            });

            const bedIcon = `<svg class="w-4 h-4 text-gray-400" fill="currentColor" viewBox="0 0 24 24"><path d="M19 7h-6V6a3 3 0 0 0-3-3H4a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1h1v1a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1h1a1 1 0 0 0 1-1V10a3 3 0 0 0-3-3zM5 5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2H5V5zm16 12H3V9h18v8z"/></svg>`;

            for (let i = 0; i < kamer.vrij; i++) {
                if (isThisPending) {
                    
                    // Als groepjes toestaan is uitgevinkt, laten we GEEN zoekbalk zien!
                    if (this.sta_groepjes_toe === false) {
                        lijstHtml += `
                            <li class="flex items-center text-sm text-gray-500 p-2 bg-gray-50 rounded-lg border border-dashed border-gray-200">
                                <div class="w-7 h-7 rounded-full bg-white border border-gray-100 flex items-center justify-center mr-3">
                                    ${bedIcon}
                                </div>
                                <span class="font-medium text-xs">Vrije plaats</span>
                            </li>
                        `;
                    } else {
                        // Wel groepjes toestaan = zoekbalk
                        const slotVal = this.roommateSearchQuery[i] || '';
                        const selected = this.selectedRoommates[i];

                        if (selected) {
                            lijstHtml += `
                                <li class="flex items-center text-sm bg-slate-50 p-2 rounded-lg border border-slate-200 relative transition-all">
                                    <div class="w-7 h-7 rounded-full flex items-center justify-center mr-3 text-xs font-semibold" style="${getAvatarStyle(selected.vnaam)}">
                                        ${selected.vnaam.charAt(0)}
                                    </div>
                                    <span class="font-medium text-slate-800">${selected.vnaam} ${selected.naam} <span class="text-xs text-gray-400 font-normal">(${selected.klas})</span></span>
                                    <button onclick="window.app.removeRoommate(${i})" class="absolute right-2 text-gray-400 hover:text-red-500 p-1 transition" title="Verwijder">
                                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                                    </button>
                                </li>
                            `;
                        } else {
                            lijstHtml += `
                                <li class="relative">
                                    <div class="flex items-center bg-white rounded-lg p-1.5 border border-gray-300 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 transition-all">
                                        <div class="w-7 h-7 rounded-full bg-gray-50 border border-gray-200 flex items-center justify-center mr-2 shrink-0 text-gray-400">
                                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                                        </div>
                                        <input type="text" id="search-slot-${i}" placeholder="Zoek medeleerling..." value="${slotVal}" onkeyup="window.app.handleSearch(event, ${i})" class="w-full text-sm p-1 bg-transparent border-none focus:outline-none focus:ring-0 text-gray-800">
                                    </div>
                                    <div id="dropdown-${i}" class="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg hidden max-h-48 overflow-y-auto"></div>
                                </li>
                            `;
                        }
                    }
                } else {
                    lijstHtml += `
                        <li class="flex items-center text-sm text-gray-500 p-2 bg-gray-50 rounded-lg border border-dashed border-gray-200">
                            <div class="w-7 h-7 rounded-full bg-white border border-gray-100 flex items-center justify-center mr-3">
                                ${bedIcon}
                            </div>
                            <span class="font-medium text-xs">Vrije plaats</span>
                        </li>
                    `;
                }
            }
            lijstHtml += '</ul>';

            let buttonHtml = '';
            if (isThisPending) {
                buttonHtml = `
                    <div class="flex gap-2 mt-auto pt-4 border-t border-gray-100">
                        <button onclick="window.app.annuleer()" class="w-1/3 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium py-2.5 rounded-lg transition text-sm">Annuleren</button>
                        <button onclick="window.app.promptBevestig('${kamer.kamer_nr}')" class="w-2/3 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg transition text-sm shadow-sm">Bevestigen</button>
                    </div>
                `;
            } else if (isUserRoom && userRes.status === 'confirmed') {
                buttonHtml = `<button disabled class="w-full mt-auto bg-green-50 text-green-700 font-medium py-2.5 rounded-lg border border-green-200 text-sm cursor-default flex items-center justify-center gap-2">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                    Jouw Plaats
                </button>`;
            } else if (lockedByOther) {
                buttonHtml = `<button disabled class="w-full mt-auto bg-gray-100 text-gray-400 font-medium py-2.5 rounded-lg border border-gray-200 text-sm cursor-not-allowed flex items-center justify-center gap-2">
                    Niet beschikbaar
                </button>`;
            } else if (isReadOnly) {
                buttonHtml = `<button disabled class="w-full mt-auto bg-gray-100 text-gray-400 font-medium py-2.5 rounded-lg border border-gray-200 text-sm cursor-not-allowed flex items-center justify-center gap-2">
                    Gesloten
                </button>`;
            } else if (hasPending || hasConfirmed) {
                buttonHtml = `<button disabled class="w-full mt-auto bg-gray-50 text-gray-400 font-medium py-2.5 rounded-lg border border-gray-100 text-sm cursor-not-allowed">Geen actie mogelijk</button>`;
            } else if (!isFull) {
                const isActiviteit = this.reisData && this.reisData.type === 'activiteit';
                const btnText = isActiviteit ? 'Schrijf mij in voor deze activiteit' : 'Kies deze plaats';
                buttonHtml = `<button onclick="window.app.promptJoin(${kamer.id}, '${kamer.kamer_nr}')" class="w-full mt-auto bg-white border border-blue-200 hover:border-blue-600 hover:bg-blue-50 text-blue-600 font-medium py-2.5 rounded-lg transition-all duration-200 text-sm flex items-center justify-center gap-2">
                    ${btnText}
                </button>`;
            } else {
                buttonHtml = `<button disabled class="w-full mt-auto bg-gray-50 text-gray-400 font-medium py-2.5 rounded-lg border border-gray-200 text-sm cursor-not-allowed">Volzet</button>`;
            }

            card.innerHTML = frozenOverlay + headerHtml + lijstHtml + buttonHtml;
            container.appendChild(card);
        });

        if (activeElementId) {
            const el = document.getElementById(activeElementId);
            if (el) {
                el.focus();
                const val = el.value;
                el.value = '';
                el.value = val;
            }
        }
    }

    async handleSearch(event, slotIndex) {
        const query = event.target.value;
        this.roommateSearchQuery[slotIndex] = query;
        const dropdown = document.getElementById(`dropdown-${slotIndex}`);

        if (query.length < 2) {
            dropdown.classList.add('hidden');
            return;
        }

        const results = await window.dbApi.searchStudent(query, this.user.geslacht, this.currentHotelId);

        if (results.length === 0) {
            dropdown.innerHTML = `<div class="p-3 text-sm text-gray-500">Geen beschikbare personen gevonden.</div>`;
            dropdown.classList.remove('hidden');
            return;
        }

        let html = '';
        results.forEach(student => {
            const isAlreadySelected = Object.values(this.selectedRoommates).find(s => s.id === student.id);
            if (!isAlreadySelected) {
                const klasTxt = student.klas && student.klas !== 'null' ? student.klas : '-';
                html += `
                    <div onclick="window.app.selectRoommate(${slotIndex}, '${student.id}', '${student.vnaam}', '${student.naam}', '${klasTxt}')"
                         class="p-2 hover:bg-slate-50 cursor-pointer border-b border-gray-100 last:border-b-0 text-sm flex items-center text-gray-700">
                        <div class="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center mr-2 text-xs font-medium">${student.vnaam.charAt(0)}</div>
                        ${student.vnaam} ${student.naam} <span class="text-xs text-gray-400 ml-1">(${klasTxt})</span>
                    </div>
                `;
            }
        });

        if (html === '') {
            html = `<div class="p-3 text-sm text-gray-500">Alle overeenkomsten zijn reeds geselecteerd.</div>`;
        }

        dropdown.innerHTML = html;
        dropdown.classList.remove('hidden');
    }

    selectRoommate(slotIndex, id, vnaam, naam, klas) {
        this.selectedRoommates[slotIndex] = { id, vnaam, naam, klas };
        this.roommateSearchQuery[slotIndex] = '';
        this.render(true); 
    }

    removeRoommate(slotIndex) {
        delete this.selectedRoommates[slotIndex];
        this.render(true); 
    }

    // NIEUW: Checkt eerst via het Modal venster voordat we de backend aanroepen (Voor als groepjes uit staan)
    async promptJoin(kamerId, kamerNr) {
        if (this.sta_groepjes_toe === false) {
            // Groepjes uit = De keuze is direct definitief! Toon modal.
            this.showConfirmModal(kamerNr, () => this.join(kamerId));
        } else {
            // Normale verloop
            this.join(kamerId);
        }
    }

    // Wordt aangeroepen na "Bevestigen" vanuit de Timer/Pending blok (Voor als groepjes wel aan staan)
    async promptBevestig(kamerNr) {
        this.showConfirmModal(kamerNr, () => this.bevestig());
    }

    async join(kamerId) {
        const res = await window.dbApi.reserveerPlek(kamerId, this.user.id);
        if (res.success) {
            // Checkt of backend direct de boeking op "Confirmed" heeft gezet (omdat groepjes uit staan)
            if (res.direct_confirmed) {
                this.showAlert("Je bent succesvol ingeschreven!", "success");
                this.render(true);
            } else {
                if (res.server_ts) this._startTimer(res.server_ts);
                this.render(true); 
            }
        } else {
            this.showAlert(res.message, "error");
        }
    }

    async bevestig() {
        const roommateIds = Object.values(this.selectedRoommates).map(rm => rm.id);
        const res = await window.dbApi.bevestigReservatie(this.user.id, roommateIds);
        
        if (res.success) {
            this._stopTimer();
            this.roommateSearchQuery = {};
            this.selectedRoommates = {};

            const currentIndex = this.hotels.findIndex(h => h.id === this.currentHotelId);
            if (currentIndex >= 0 && currentIndex < this.hotels.length - 1) {
                this.setHotel(this.hotels[currentIndex + 1].id);
            }
            
            if (res.message && res.message.includes('veilig')) {
                this.showAlert(res.message, "info"); 
            } else {
                this.showAlert("Je inschrijving is definitief bevestigd.", "success");
            }
        } else {
            this.showAlert(res.message, "error");
            this.render(true);
        }
    }

    async annuleer() {
        this._stopTimer();
        await window.dbApi.annuleerPending(this.user.id);
        this.roommateSearchQuery = {};
        this.selectedRoommates = {};
        this.render(true); 
    }

    logout() {
        const user = this.user;
        let redirectUrl = 'login.html';
        
        if (user && user.school_slug && user.reis_slug) {
            redirectUrl = `login.html?school=${user.school_slug}&reis=${user.reis_slug}`;
        }
        
        window.dbApi.logout();
        
        document.body.classList.add('page-exit');
        
        setTimeout(() => {
            window.location.href = redirectUrl;
        }, 550);
    }

    showAlert(msg, type) {
        const box = document.getElementById('alertBox');
        box.innerText = msg;
        box.className = 'fixed top-4 right-4 z-[60] p-4 rounded-lg border shadow-lg transition-opacity font-medium max-w-sm text-sm';

        if (type === 'success') box.classList.add('bg-green-50', 'text-green-800', 'border-green-200');
        else if (type === 'error') box.classList.add('bg-red-50', 'text-red-800', 'border-red-200');
        else box.classList.add('bg-blue-50', 'text-blue-800', 'border-blue-200');

        setTimeout(() => {
            box.classList.add('opacity-0');
            setTimeout(() => box.className = 'hidden', 300);
        }, 4000);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});
