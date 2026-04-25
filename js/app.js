// app.js - Core Frontend Logica

class App {
    constructor() {
        this.user = window.dbApi.getCurrentUser();
        if (!this.user) {
            window.location.href = 'login.html';
            return;
        }

        this.currentHotelId = 1;
        this.roommateSearchQuery = {};
        this.selectedRoommates = {};

        // TIMER STATE — eenmalig gezet, NOOIT overschreven door re-renders
        this._lockStartServerMs = null;
        this._timerActive = false;

        this.init();
    }

    async init() {
        document.getElementById('userInfo').innerText = `${this.user.vnaam} ${this.user.naam} (${this.user.geslacht === 'M' ? 'Jongen' : 'Meisje'})`;

        await window.dbApi.initializeDB();
        await window.dbApi.syncServerTime();

        this.render(true); // Forceer de allereerste render

        // Realtime WebSockets
        const channel = window.dbApi.supabaseClient
            .channel('realtime_reserveringen')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'reservering' }, payload => {
                console.log('⚡ LIVE update ontvangen:', payload);
                this.render(); // Zachte render (wordt genegeerd als je typt)
            })
            .subscribe((status) => {
                console.log('🔌 Realtime status:', status);
            });

        // Fallback: ververs data elke 5 seconden
        setInterval(async () => {
            await window.dbApi.checkTimeouts();
            this.render(); // Zachte render (wordt genegeerd als je typt)
        }, 5000);

        // Timer tikt elke seconde (ONAFHANKELIJK van render)
        setInterval(() => {
            this._tickTimer();
        }, 1000);
    }

    // ─── TIMER LOGICA (robuust, niet-onderbreekbaar) ───

    _startTimer(serverTimestamp) {
        if (this._timerActive) return; 
        this._lockStartServerMs = serverTimestamp;
        this._timerActive = true;
        console.log('⏱️ Timer gestart, server_ts:', serverTimestamp);
    }

    _stopTimer() {
        this._lockStartServerMs = null;
        this._timerActive = false;
    }

    _getRemaining() {
        if (!this._lockStartServerMs) return -1;
        const serverNow = window.dbApi.getEstimatedServerTime();
        const elapsed = Math.floor((serverNow - this._lockStartServerMs) / 1000);
        return Math.max(0, 60 - elapsed);
    }

    _tickTimer() {
        if (!this._timerActive) return;

        const remaining = this._getRemaining();
        const display = document.getElementById('timerDisplay');

        if (display) {
            display.innerText = remaining + 's';
            if (remaining <= 10) {
                display.classList.add('text-red-600', 'bg-red-100', 'animate-pulse');
                display.classList.remove('text-orange-700', 'bg-orange-100');
            }
        }

        // Auto-annuleer bij 0
        if (remaining <= 0) {
            console.log('⏱️ Timer verlopen, auto-annuleer');
            this._stopTimer();
            this.annuleer();
        }
    }

    // ─── HOTEL TABS ───

    setHotel(hotelId) {
        this.currentHotelId = hotelId;

        if (hotelId === 1) {
            document.body.style.backgroundImage = "url('b70426ffce14d5cb756f48dbb7b7c77965c19194f27cdad21906f39bbb9d.webp')";
        } else {
            document.body.style.backgroundImage = "url('DSC_0042.jpg')";
        }

        document.getElementById('tab-1').className = hotelId === 1
            ? "px-6 py-2 rounded-lg font-medium text-sm transition shadow-sm bg-white text-gray-800"
            : "px-6 py-2 rounded-lg font-medium text-sm transition text-gray-600 hover:text-gray-800";

        document.getElementById('tab-2').className = hotelId === 2
            ? "px-6 py-2 rounded-lg font-medium text-sm transition shadow-sm bg-white text-gray-800"
            : "px-6 py-2 rounded-lg font-medium text-sm transition text-gray-600 hover:text-gray-800";

        this.render(true); // Forceer render bij wisselen van tabblad
    }

    // ─── MAIN RENDER ───

    async render(force = false) {
        // OPLOSSING: Controleer of de gebruiker aan het typen is
        const isTyping = document.activeElement && document.activeElement.tagName === 'INPUT';
        
        // Als de gebruiker typt, en het is geen verplichte (force) update, stop dan met renderen!
        if (isTyping && !force) {
            return;
        }

        const overlay = document.getElementById('cardOverlay');
        const container = document.getElementById('kamersContainer');
        const kamers = await window.dbApi.getKamersMetStatus(this.currentHotelId, this.user.geslacht);

        let userRes = null;
        for (let kamer of kamers) {
            const res = kamer.reservaties.find(r => r.gebruikerid === this.user.id);
            if (res) userRes = res;
        }
        const hasPending = userRes && userRes.status === 'pending';
        const hasConfirmed = userRes && userRes.status === 'confirmed';

        const getAvatarStyle = (name) => {
            let hash = 0;
            for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
            return `background: linear-gradient(135deg, hsl(${Math.abs(hash % 360)}, 70%, 60%), hsl(${(Math.abs(hash % 360) + 40) % 360}, 70%, 50%)); color: white;`;
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

        // We bewaren de focus voor de zekerheid (bijv. als er wél een 'force' was)
        const activeElementId = document.activeElement ? document.activeElement.id : null;

        container.innerHTML = '';

        kamers.forEach(kamer => {
            const isFull = kamer.vrij <= 0;
            const isUserRoom = userRes && userRes.kamerid === kamer.id;
            const isThisPending = isUserRoom && userRes.status === 'pending';
            const lockedByOther = kamer.isLocked && !isUserRoom;

            let cardClasses = `kamer-card bg-white rounded-2xl p-5 border border-gray-200 relative overflow-visible `;

            if (isThisPending) {
                cardClasses = `fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[90%] max-w-md z-50 bg-white rounded-2xl p-6 border-4 border-orange-500 shadow-2xl transition-all duration-300`;
            } else if (isUserRoom && userRes.status === 'confirmed') {
                cardClasses += `border-green-500 border-2 shadow-green-100`;
            } else if (lockedByOther) {
                cardClasses += `frozen-room opacity-75 pointer-events-none`;
            }

            const card = document.createElement('div');
            card.className = cardClasses;

            let timerHtml = '';
            if (isThisPending) {
                const rem = this._getRemaining();
                timerHtml = `<div class="bg-orange-100 text-orange-700 px-3 py-1 rounded-lg font-bold font-mono shadow-inner text-lg" id="timerDisplay">${rem >= 0 ? rem : 60}s</div>`;
            }

            let frozenOverlay = '';
            if (lockedByOther) {
                frozenOverlay = `
                    <div class="frozen-overlay absolute inset-0 bg-gray-900/10 backdrop-blur-[1px] rounded-2xl z-10 flex flex-col items-center justify-center gap-2 pointer-events-none">
                        <svg class="w-8 h-8 text-orange-500 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
                        <span class="text-xs font-bold text-orange-700 bg-orange-100 px-3 py-1 rounded-full">Wordt geconfigureerd...</span>
                    </div>`;
            }

            const fillPct = (kamer.bezet / kamer.capaciteit) * 100;
            const progressColor = isFull ? 'bg-red-500' : 'bg-orange-500';

            let headerHtml = `
                <div class="flex justify-between items-start mb-3">
                    <div>
                        <h3 class="text-xl font-extrabold text-gray-800 tracking-tight">Kamer ${kamer.kamer_nr}</h3>
                        <p class="text-xs text-gray-400 mt-1 uppercase tracking-wider font-semibold flex items-center gap-1">
                            <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clip-rule="evenodd"></path></svg>
                            ${kamer.hotelid === 1 ? 'Como' : 'Montecatini'}
                        </p>
                    </div>
                    ${timerHtml || `<span class="text-sm font-bold px-3 py-1 rounded-full ${isFull ? 'bg-red-50 text-red-600' : lockedByOther ? 'bg-orange-50 text-orange-600' : 'bg-orange-50 text-orange-600'} shadow-sm">
                        ${lockedByOther ? '🔒' : kamer.bezet + '/' + kamer.capaciteit}
                    </span>`}
                </div>
                <div class="w-full bg-gray-100 rounded-full h-1.5 mb-5 overflow-hidden">
                    <div class="${progressColor} h-1.5 rounded-full transition-all duration-500" style="width: ${fillPct}%"></div>
                </div>
            `;

            let lijstHtml = '<ul class="space-y-3 mb-6 min-h-[80px] relative">';

            kamer.reservaties.forEach(r => {
                const isMe = r.gebruiker.id === this.user.id;
                let statusBadge = r.status === 'confirmed' ? '<svg class="w-4 h-4 text-green-500 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>' : '';

                lijstHtml += `
                    <li class="flex items-center text-sm ${isMe ? 'font-bold text-gray-900 bg-orange-50/50 p-2 rounded-xl border border-orange-100 shadow-sm' : 'text-gray-600 p-2'}">
                        <div class="w-8 h-8 rounded-full flex items-center justify-center mr-3 text-xs font-bold shadow-inner" style="${getAvatarStyle(r.gebruiker.vnaam)}">
                            ${r.gebruiker.vnaam.charAt(0)}${r.gebruiker.naam.charAt(0)}
                        </div>
                        ${r.gebruiker.vnaam} ${r.gebruiker.naam} ${isMe && isThisPending ? '<span class="ml-2 text-xs text-orange-500 animate-pulse">(Jij...)</span>' : statusBadge}
                    </li>
                `;
            });

            const bedIcon = `<svg class="w-5 h-5 text-gray-300" fill="currentColor" viewBox="0 0 24 24"><path d="M19 7h-6V6a3 3 0 0 0-3-3H4a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1h1v1a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1h1a1 1 0 0 0 1-1V10a3 3 0 0 0-3-3zM5 5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2H5V5zm16 12H3V9h18v8z"/></svg>`;

            for (let i = 0; i < kamer.vrij; i++) {
                if (isThisPending) {
                    const slotVal = this.roommateSearchQuery[i] || '';
                    const selected = this.selectedRoommates[i];

                    if (selected) {
                        lijstHtml += `
                            <li class="flex items-center text-sm bg-blue-50 p-2 rounded-xl border border-blue-200 relative shadow-sm transition-all">
                                <div class="w-8 h-8 rounded-full flex items-center justify-center mr-3 text-xs font-bold shadow-inner" style="${getAvatarStyle(selected.vnaam)}">
                                    ${selected.vnaam.charAt(0)}
                                </div>
                                <span class="font-bold text-blue-900">${selected.vnaam} ${selected.naam}</span>
                                <button onclick="window.app.removeRoommate(${i})" class="absolute right-3 text-gray-400 hover:text-red-500 bg-white rounded-full p-1 shadow-sm transition transform hover:scale-110">
                                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                                </button>
                            </li>
                        `;
                    } else {
                        lijstHtml += `
                            <li class="relative">
                                <div class="flex items-center bg-gray-50 rounded-xl p-1 border border-gray-200 focus-within:border-orange-400 focus-within:ring-2 focus-within:ring-orange-100 transition-all">
                                    <div class="w-8 h-8 rounded-full bg-white border border-gray-200 flex items-center justify-center mr-2 shrink-0 shadow-sm text-gray-400">
                                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                                    </div>
                                    <input type="text" id="search-slot-${i}" placeholder="Zoek medeleerling..." value="${slotVal}" onkeyup="window.app.handleSearch(event, ${i})" class="w-full text-sm p-1 bg-transparent border-none focus:outline-none focus:ring-0 text-gray-700">
                                </div>
                                <div id="dropdown-${i}" class="absolute z-10 w-[90%] left-[5%] mt-1 bg-white border border-gray-200 rounded-xl shadow-2xl hidden max-h-40 overflow-y-auto"></div>
                            </li>
                        `;
                    }
                } else {
                    lijstHtml += `
                        <li class="flex items-center text-sm text-gray-400 p-2 bg-gray-50/50 rounded-xl border border-dashed border-gray-200">
                            <div class="w-8 h-8 rounded-full bg-white border border-gray-100 flex items-center justify-center mr-3 shadow-sm">
                                ${bedIcon}
                            </div>
                            <span class="italic font-medium">Vrij bed</span>
                        </li>
                    `;
                }
            }
            lijstHtml += '</ul>';

            let buttonHtml = '';
            if (isThisPending) {
                buttonHtml = `
                    <div class="flex gap-3 mt-auto pt-4 border-t border-gray-100">
                        <button onclick="window.app.annuleer()" class="w-1/3 bg-gray-100 hover:bg-gray-200 text-gray-600 font-semibold py-3 rounded-xl transition">Annuleren</button>
                        <button onclick="window.app.bevestig()" class="w-2/3 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white font-bold py-3 rounded-xl shadow-lg transition transform hover:-translate-y-0.5">Bevestig Kamer</button>
                    </div>
                `;
            } else if (isUserRoom && userRes.status === 'confirmed') {
                buttonHtml = `<button disabled class="w-full mt-auto bg-green-50 text-green-700 font-bold py-3 rounded-xl border border-green-200 cursor-default flex items-center justify-center gap-2">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    Jouw Kamer
                </button>`;
            } else if (lockedByOther) {
                buttonHtml = `<button disabled class="w-full mt-auto bg-orange-50 text-orange-400 font-medium py-3 rounded-xl border border-orange-200 cursor-not-allowed flex items-center justify-center gap-2">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
                    Bevroren
                </button>`;
            } else if (hasPending || hasConfirmed) {
                buttonHtml = `<button disabled class="w-full mt-auto bg-gray-50 text-gray-400 font-medium py-3 rounded-xl border border-gray-100 cursor-not-allowed">Niet beschikbaar</button>`;
            } else if (!isFull) {
                buttonHtml = `<button onclick="window.app.join(${kamer.id})" class="w-full mt-auto relative group overflow-hidden bg-white border-2 border-orange-100 hover:border-orange-400 text-orange-600 font-bold py-3 rounded-xl transition-all duration-300 shadow-sm hover:shadow-md">
                    <span class="relative z-10 flex items-center justify-center gap-2">
                        Kies deze kamer
                        <svg class="w-4 h-4 transition transform group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>
                    </span>
                    <div class="absolute inset-0 h-full w-0 bg-orange-50 transition-all duration-300 ease-out group-hover:w-full z-0"></div>
                </button>`;
            } else {
                buttonHtml = `<button disabled class="w-full mt-auto bg-red-50 text-red-400 font-bold py-3 rounded-xl border border-red-100 cursor-not-allowed">Kamer Volzet</button>`;
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

    // ─── SEARCH & ROOMMATES ───

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
            dropdown.innerHTML = `<div class="p-3 text-sm text-gray-500">Geen vrije leerlingen gevonden.</div>`;
            dropdown.classList.remove('hidden');
            return;
        }

        let html = '';
        results.forEach(student => {
            const isAlreadySelected = Object.values(this.selectedRoommates).find(s => s.id === student.id);
            if (!isAlreadySelected) {
                html += `
                    <div onclick="window.app.selectRoommate(${slotIndex}, '${student.id}', '${student.vnaam}', '${student.naam}')"
                         class="p-3 hover:bg-orange-50 cursor-pointer border-b last:border-b-0 text-sm flex items-center">
                        <div class="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center mr-2 text-xs">${student.vnaam.charAt(0)}</div>
                        ${student.vnaam} ${student.naam}
                    </div>
                `;
            }
        });

        if (html === '') {
            html = `<div class="p-3 text-sm text-gray-500">Alle matches zijn al geselecteerd.</div>`;
        }

        dropdown.innerHTML = html;
        dropdown.classList.remove('hidden');
    }

    selectRoommate(slotIndex, id, vnaam, naam) {
        this.selectedRoommates[slotIndex] = { id, vnaam, naam };
        this.roommateSearchQuery[slotIndex] = '';
        this.render(true); // Verplichte render omdat de status van de kamer is gewijzigd
    }

    removeRoommate(slotIndex) {
        delete this.selectedRoommates[slotIndex];
        this.render(true); // Verplichte render omdat de status is gewijzigd
    }

    // ─── ACTIES ───

    async join(kamerId) {
        const res = await window.dbApi.reserveerPlek(kamerId, this.user.id);
        if (res.success) {
            if (res.server_ts) {
                this._startTimer(res.server_ts);
            }
            this.render(true); // Verplichte render om de popup te tonen
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

            const nextHotelId = this.currentHotelId === 1 ? 2 : 1;
            this.setHotel(nextHotelId);
            this.showAlert("Opgeslagen! Controleer je kamers.", "success");
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
        this.render(true); // Verplichte render om de popup te sluiten
    }

    logout() {
        window.dbApi.logout();
        window.location.href = 'login.html';
    }

    showAlert(msg, type) {
        const box = document.getElementById('alertBox');
        box.innerText = msg;
        box.className = 'fixed top-4 right-4 z-50 p-4 rounded-xl border shadow-xl transition-opacity font-medium max-w-sm';

        if (type === 'success') box.classList.add('bg-green-100', 'text-green-800', 'border-green-300');
        else if (type === 'error') box.classList.add('bg-red-100', 'text-red-800', 'border-red-300');
        else box.classList.add('bg-blue-100', 'text-blue-800', 'border-blue-300');

        setTimeout(() => {
            box.classList.add('opacity-0');
            setTimeout(() => box.className = 'hidden', 300);
        }, 4000);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});
