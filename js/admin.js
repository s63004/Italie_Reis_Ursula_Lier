// admin.js - Logica voor het Admin Paneel (Multi-Tenant, Klassen & Geprofessionaliseerd)

class AdminApp {
    constructor() {
        this.user = window.dbApi.getCurrentUser();
        if ((!this.user || !this.user.isLeerkracht) && !document.getElementById('adminLoginScreen')) {
            alert("Toegang geweigerd. Alleen voor leerkrachten.");
            window.location.href = 'login.html';
            return;
        }

        if (this.user && this.user.dummy) return;

        this.currentTab = 'reizen'; 
        this.hotels = [];
        this.reizen = []; 
        this.editContext = null; 
        this.init();
    }

    async init() {
        if(!this.user) return; 

        document.getElementById('userInfo').innerText = `Admin: ${this.user.vnaam} ${this.user.naam}`;
        
        const settings = await window.dbApi.getAppSettings();
        if (settings.app_title) {
            if (document.getElementById('navTitle')) document.getElementById('navTitle').innerText = settings.app_title + " Beheer";
            if (document.getElementById('pageTitle')) document.title = settings.app_title + " Beheer";
        }

        this.reizen = await window.dbApi.getReizen(false);
        this.hotels = await window.dbApi.getHotels(false);
        
        this.populateReisDropdown(); 
        this.populateHotelDropdowns();
        this.populateExportDropdown(); 

        this.setTab(this.currentTab);

        if (!this._eventsAttached) {
            const addReisForm = document.getElementById('addReisForm');
            if (addReisForm) {
                addReisForm.addEventListener('submit', (e) => {
                    e.preventDefault();
                    this.addReis();
                });
            }

            document.getElementById('addKamerForm').addEventListener('submit', (e) => {
                e.preventDefault();
                this.addKamer();
            });

            document.getElementById('addLeerlingForm').addEventListener('submit', (e) => {
                e.preventDefault();
                this.addLeerling();
            });

            document.getElementById('changePasswordForm').addEventListener('submit', (e) => {
                e.preventDefault();
                this.changePassword();
            });

            const addBestemmingForm = document.getElementById('addBestemmingForm');
            if (addBestemmingForm) {
                addBestemmingForm.addEventListener('submit', (e) => {
                    e.preventDefault();
                    this.addBestemming();
                });
            }

            const client = window.dbApi.supabaseClient;
            client.channel('admin_realtime')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'reservering' }, () => this.refreshCurrentTab())
                .on('postgres_changes', { event: '*', schema: 'public', table: 'persoon' }, () => this.refreshCurrentTab())
                .on('postgres_changes', { event: '*', schema: 'public', table: 'kamer' }, () => this.refreshCurrentTab())
                .on('postgres_changes', { event: '*', schema: 'public', table: 'hotel' }, () => this.refreshCurrentTab())
                .subscribe();

            setInterval(() => {
                if(this.user && !this.user.dummy) this.refreshCurrentTab();
            }, 5000);

            const filterKlasBtn = document.getElementById('filter_l_klas');
            if (filterKlasBtn) {
                filterKlasBtn.addEventListener('change', () => this.renderLeerlingen());
            }

            this._eventsAttached = true;
        }

        // NIEUW: Genereer de vinkjes voor de klassen
        this.populateKlassenCheckboxes();
    }

    // --- NIEUW: Automatisch lijst van alle klassen in school ophalen ---
    async getUniekeKlassen() {
        const leerlingen = await window.dbApi.getAllLeerlingen();
        return [...new Set(leerlingen.map(l => l.klas))].filter(k => k && k !== 'null' && k !== '-').sort();
    }

    async populateKlassenCheckboxes() {
        const klassen = await this.getUniekeKlassen();
        const container = document.getElementById('r_klassen_container');
        if (!container) return;
        
        if (klassen.length === 0) {
            container.innerHTML = '<span class="text-slate-400 italic text-xs">Geen klassen in database gevonden</span>';
            return;
        }

        let html = `
            <label class="flex items-center gap-2 cursor-pointer p-1.5 hover:bg-slate-50 rounded transition">
                <input type="checkbox" id="r_klassen_all" value="*" checked class="w-3.5 h-3.5 text-primary-600 rounded border-slate-300 focus:ring-primary-500 cursor-pointer">
                <span class="font-bold text-slate-800 text-xs">Alle klassen selecteren (*)</span>
            </label>
            <div class="border-t border-slate-100 my-1"></div>
        `;

        klassen.forEach(k => {
            html += `
            <label class="klas-item flex items-center gap-2 cursor-pointer ml-1 p-1 hover:bg-slate-50 rounded transition" data-klas="${k.toLowerCase()}">
                <input type="checkbox" name="r_klas_optie" value="${k}" checked class="w-3.5 h-3.5 text-primary-600 rounded border-slate-300 focus:ring-primary-500 cursor-pointer">
                <span class="text-slate-700 text-xs font-medium">${k}</span>
            </label>`;
        });

        container.innerHTML = html;

        // --- LOGICA 1: Zoekbalk filter ---
        const searchInput = document.getElementById('r_klas_zoek');
        if(searchInput) {
            searchInput.addEventListener('input', (e) => {
                const term = e.target.value.toLowerCase();
                document.querySelectorAll('.klas-item').forEach(el => {
                    if(el.dataset.klas.includes(term)) {
                        el.style.display = 'flex';
                    } else {
                        el.style.display = 'none';
                    }
                });
            });
        }

        // --- LOGICA 2: "Alle klassen" checkbox ---
        const allCb = document.getElementById('r_klassen_all');
        const klasCbs = document.getElementsByName('r_klas_optie');
        
        function checkAlleKlassenStatus() {
            const allemaalAan = Array.from(klasCbs).every(c => c.checked);
            allCb.checked = allemaalAan;
        }

        allCb.addEventListener('change', (e) => {
            klasCbs.forEach(cb => {
                // Pas alleen de zichtbare checkboxes aan bij gebruik van de zoekbalk
                const parent = cb.closest('.klas-item');
                if (parent.style.display !== 'none') {
                    cb.checked = e.target.checked;
                }
            });
        });
        
        klasCbs.forEach(cb => {
            cb.addEventListener('change', checkAlleKlassenStatus);
        });

        // --- LOGICA 3: Jaren Snelselectie (1ste, 2de, 6de...) ---
        document.querySelectorAll('.jaar-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault(); // Voorkom dat formulier submit
                const jaar = e.target.dataset.jaar; 
                
                // Haal alle klassen op die met dit cijfer beginnen (bijv. "6BIW" begint met "6")
                const relevantCbs = Array.from(klasCbs).filter(cb => cb.value.startsWith(jaar));
                if(relevantCbs.length === 0) {
                    // Toon even een visuele waarschuwing als er geen klassen voor dit jaar zijn
                    const origineleTekst = e.target.innerText;
                    e.target.innerText = "Geen";
                    e.target.classList.add('bg-red-50', 'text-red-600', 'border-red-200');
                    setTimeout(() => {
                        e.target.innerText = origineleTekst;
                        e.target.classList.remove('bg-red-50', 'text-red-600', 'border-red-200');
                    }, 1000);
                    return;
                }
                
                // Kijk of we ze aan of uit moeten zetten (toggle)
                const allemaalAan = relevantCbs.every(cb => cb.checked);
                
                // Visual feedback op de knop
                e.target.classList.add('bg-primary-100', 'border-primary-500');
                setTimeout(() => e.target.classList.remove('bg-primary-100', 'border-primary-500'), 300);

                relevantCbs.forEach(cb => cb.checked = !allemaalAan);
                
                // Zorg dat de algemene "Alle klassen" checkbox mee update
                checkAlleKlassenStatus();
            });
        });
    }

    populateReisDropdown() {
        const select = document.getElementById('b_reis');
        if(!select) return;
        select.innerHTML = '';
        this.reizen.forEach(r => {
            const opt = document.createElement('option');
            opt.value = r.id;
            opt.innerText = r.naam;
            select.appendChild(opt);
        });
    }

    populateHotelDropdowns() {
        const selectAdd = document.getElementById('k_hotel');
        const selectFilter = document.getElementById('filter_k_hotel');
        
        if(selectAdd) selectAdd.innerHTML = '';
        if(selectFilter) {
            selectFilter.innerHTML = '';
            const allOpt = document.createElement('option');
            allOpt.value = "";
            allOpt.innerText = "--- Toon alle opties/locaties ---";
            selectFilter.appendChild(allOpt);
        }

        this.hotels.forEach(h => {
            const reisNaam = h.reis ? h.reis.naam : 'Geen Activiteit'; 
            
            if(selectAdd) {
                const optAdd = document.createElement('option');
                optAdd.value = h.id;
                optAdd.innerText = `${h.naam} (${reisNaam})`; 
                selectAdd.appendChild(optAdd);
            }
            
            if(selectFilter) {
                const optFilter = document.createElement('option');
                optFilter.value = h.id;
                optFilter.innerText = `${h.naam} (${reisNaam})`; 
                selectFilter.appendChild(optFilter);
            }
        });
    }

    populateExportDropdown() {
        const selectExport = document.getElementById('export_reis_filter');
        if (!selectExport) return;
        
        selectExport.innerHTML = '<option value="">--- Alle Activiteiten / Reizen exporteren ---</option>';
        this.reizen.forEach(r => {
            const opt = document.createElement('option');
            opt.value = r.id;
            opt.innerText = r.naam;
            selectExport.appendChild(opt);
        });
    }

    refreshCurrentTab() {
        if (this.currentTab === 'reizen') this.renderReizen(); 
        if (this.currentTab === 'kamers') this.renderKamers();
        if (this.currentTab === 'reservaties') this.renderReservaties();
        if (this.currentTab === 'leerlingen') this.renderLeerlingen();
        if (this.currentTab === 'bestemmingen') this.renderBestemmingen();
    }

    setTab(tab) {
        this.currentTab = tab;
        
        ['reizen', 'kamers', 'reservaties', 'leerlingen', 'instellingen', 'bestemmingen', 'export'].forEach(t => {
            const contentEl = document.getElementById(`content-${t}`);
            if(contentEl) contentEl.classList.add('hidden');
            
            const navBtn = document.getElementById(`nav-${t}`);
            if(navBtn) {
                navBtn.classList.remove('text-orange-600', 'bg-orange-50', 'border-l-4', 'border-orange-500', 'text-green-600', 'bg-green-50', 'border-green-500');
                navBtn.classList.add('text-gray-600');
            }
        });

        const activeContent = document.getElementById(`content-${tab}`);
        if(activeContent) activeContent.classList.remove('hidden');
        
        const activeNav = document.getElementById(`nav-${tab}`);
        if(activeNav) {
            activeNav.classList.remove('text-gray-600');
            if (tab === 'export') {
                activeNav.classList.add('text-green-600', 'bg-green-50', 'border-l-4', 'border-green-500');
            } else {
                activeNav.classList.add('text-orange-600', 'bg-orange-50', 'border-l-4', 'border-orange-500');
            }
        }

        this.refreshCurrentTab();
    }

    // --- REIZEN / ACTIVITEITEN LOGICA ---
    async renderReizen() {
        const tbody = document.getElementById('reizenTableBody');
        if (!tbody) return;
        
        this.reizen = await window.dbApi.getReizen(false);
        tbody.innerHTML = '';

        let baseUrl = window.location.href.split('admin.html')[0];
        const schoolSlug = this.user.school_slug || 'school';

        this.reizen.forEach(r => {
            const tr = document.createElement('tr');
            tr.className = 'border-b hover:bg-gray-50 transition';
            
            const fullLink = `${baseUrl}login.html?school=${schoolSlug}&reis=${r.slug}`;
            
            const groepjesText = r.sta_groepjes_toe !== false ? 'Groepjes (Ja)' : 'Individueel (Nee)';
            const klassenText = r.toegestane_klassen && r.toegestane_klassen !== '*' ? r.toegestane_klassen : 'Alle klassen';

            tr.innerHTML = `
                <td class="p-3 font-medium">${r.naam}</td>
                <td class="p-3 text-sm text-gray-500">
                    ${r.slug}<br>
                    <button onclick="window.adminApp.copyLink('${fullLink}')" class="text-xs mt-1 bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded border border-gray-300 transition shadow-sm font-medium">Kopieer Link</button>
                </td>
                <td class="p-3 text-xs text-gray-600">
                    <span class="block"><b>Klassen:</b> ${klassenText}</span>
                    <span class="block"><b>Type:</b> ${groepjesText}</span>
                </td>
                <td class="p-3 text-right">
                    <button onclick="window.adminApp.editReis(${r.id})" class="text-blue-600 hover:underline mr-3 font-medium">Bewerk</button>
                    <button onclick="window.adminApp.deleteReis(${r.id})" class="text-red-600 hover:underline font-medium">Verwijder</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    async addReis() {
        const submitBtn = document.querySelector('#addReisForm button[type="submit"]');
        if (submitBtn && submitBtn.disabled) return; 
        
        const naam = document.getElementById('r_naam').value;
        const slug = document.getElementById('r_slug').value;
        const fileInput = document.getElementById('r_foto');
        const file = fileInput.files[0];
        
        // NIEUW: Bepaal de String van de geselecteerde klassen
        let klassen = '*';
        const allCb = document.getElementById('r_klassen_all');
        if (allCb && !allCb.checked) {
            const checkedOptions = Array.from(document.getElementsByName('r_klas_optie')).filter(cb => cb.checked).map(cb => cb.value);
            klassen = checkedOptions.length > 0 ? checkedOptions.join(', ') : 'NIEMAND';
        }
        
        if (!file) return this.showAlert("Selecteer een achtergrondafbeelding.", "error");

        // Verzamel alle nieuwe data via de helper-functies
        const zichtbaarheid = window.verzamelZichtbaarheidData ? window.verzamelZichtbaarheidData.call(this) : {};
        if (zichtbaarheid === false) return; // Validatie gefaald

        const periode = window.verzamelReisPeriodeData ? window.verzamelReisPeriodeData.call(this) : {};
        if (periode === false) return;

        const inschrijfFase = window.verzamelInschrijvingFaseData ? window.verzamelInschrijvingFaseData.call(this) : {};
        if (inschrijfFase === false) return;

        const eventType = window.verzamelEventTypeData ? window.verzamelEventTypeData.call(this) : { type: 'hotel', max_personen_per_groep: 4 };
        if (eventType === false) return;

        const herhaling = window.verzamelHerhalingData ? window.verzamelHerhalingData.call(this) : { herhaling_frequentie: 'eenmalig' };
        
        const inlogReg = {
            smartschool_toegestaan: document.getElementById('toggle_smartschool') ? document.getElementById('toggle_smartschool').checked : true,
            manueel_toegestaan: document.getElementById('toggle_manual') ? document.getElementById('toggle_manual').checked : false,
            geslacht_verplicht: document.getElementById('toggle_gender') ? document.getElementById('toggle_gender').checked : false
        };

        const groepsinschrijving = document.getElementById('r_groepjes') ? document.getElementById('r_groepjes').checked : true;

        let origineleTekst = "Aanmaken";
        if(submitBtn) {
            submitBtn.disabled = true;
            origineleTekst = submitBtn.innerText;
            submitBtn.innerText = "Bezig...";
        }

        this.showAlert("Afbeelding wordt geüpload...", "info");

        const uploadRes = await window.dbApi.uploadAfbeelding(file);
        if (!uploadRes.success) {
            if(submitBtn) { submitBtn.disabled = false; submitBtn.innerText = origineleTekst; }
            return this.showAlert("Upload mislukt: " + uploadRes.message, "error");
        }

        // Bouw het complete object
        const reisConfig = {
            naam,
            slug,
            login_bg: uploadRes.url,
            toegestane_klassen: klassen,
            sta_groepjes_toe: eventType.type === 'activiteit' ? false : groepsinschrijving,
            ...zichtbaarheid,
            ...periode,
            ...inschrijfFase,
            ...eventType,
            ...herhaling,
            ...inlogReg
        };

        const res = await window.dbApi.addReis(reisConfig);
        
        if(submitBtn) { submitBtn.disabled = false; submitBtn.innerText = origineleTekst; }

        if (res.success) {
            this.showAlert("Activiteit succesvol aangemaakt.", "success");
            document.getElementById('addReisForm').reset();
            this.setTab('reizen'); // Ga terug naar overzicht
            await this.init(); 
        } else {
            this.showAlert(res.message || "Fout bij aanmaken.", "error");
        }
    }

    async deleteReis(id) {
        if(confirm("Waarschuwing: Dit verwijdert de activiteit inclusief alle gekoppelde locaties, opties en reservaties. Doorgaan?")) {
            const res = await window.dbApi.deleteReis(id);
            if(res.success) {
                this.showAlert("Activiteit verwijderd.", "info");
                await this.init();
            } else {
                this.showAlert(res.message, "error");
            }
        }
    }

    async editReis(id) {
        const r = this.reizen.find(x => x.id === id);
        if(!r) return;
        this.editContext = { type: 'reis', id: id };
        
        // NIEUW: Genereren van de checklist voor in het bewerk venster
        const klassenLijst = await this.getUniekeKlassen();
        const geselecteerd = r.toegestane_klassen ? r.toegestane_klassen.split(',').map(s => s.trim()) : [];
        const isAll = r.toegestane_klassen === '*' || r.toegestane_klassen === '' || !r.toegestane_klassen;

        let klassenHtml = `
            <div class="w-full border border-slate-300 px-3 py-2 rounded-md text-sm shadow-sm bg-white max-h-32 overflow-y-auto flex flex-col gap-1 custom-scrollbar">
                <label class="flex items-center gap-2 cursor-pointer p-1 hover:bg-slate-50 rounded">
                    <input type="checkbox" id="edit_modal_klassen_all" value="*" ${isAll ? 'checked' : ''} onchange="
                        document.getElementsByName('edit_klas_optie').forEach(cb => cb.checked = this.checked);
                    " class="w-3.5 h-3.5 text-primary-600 rounded border-slate-300">
                    <span class="font-bold text-slate-700 text-xs">Alle klassen (*)</span>
                </label>
                <div class="border-t border-slate-100 my-1"></div>
        `;

        klassenLijst.forEach(k => {
            const isChecked = isAll || geselecteerd.includes(k);
            klassenHtml += `
                <label class="flex items-center gap-2 cursor-pointer ml-1 p-1 hover:bg-slate-50 rounded">
                    <input type="checkbox" name="edit_klas_optie" value="${k}" ${isChecked ? 'checked' : ''} onchange="
                        if(!this.checked) document.getElementById('edit_modal_klassen_all').checked = false;
                        if(Array.from(document.getElementsByName('edit_klas_optie')).every(c => c.checked)) document.getElementById('edit_modal_klassen_all').checked = true;
                    " class="w-3.5 h-3.5 text-primary-600 rounded border-slate-300">
                    <span class="text-slate-700 text-xs">${k}</span>
                </label>
            `;
        });
        klassenHtml += `</div>`;

        document.getElementById('modalTitle').innerText = 'Activiteit Aanpassen';
        document.getElementById('modalFields').innerHTML = `
            <div>
                <label class="block text-sm font-medium mb-1">Naam</label>
                <input type="text" id="edit_modal_naam" value="${r.naam}" class="w-full p-2 border rounded">
            </div>
            <div>
                <label class="block text-sm font-medium mb-1">URL Slug</label>
                <input type="text" id="edit_modal_slug" value="${r.slug}" class="w-full p-2 border rounded">
            </div>
            <div>
                <label class="block text-sm font-medium mb-1">Toegestane Klassen</label>
                ${klassenHtml}
            </div>
            <div>
                <label class="block text-sm font-medium mb-1">Nieuwe Achtergrondfoto (Optioneel)</label>
                <input type="file" id="edit_modal_foto" accept="image/*" class="w-full p-1.5 border rounded">
            </div>
            <div class="flex flex-col gap-2 mt-3 border-t border-slate-100 pt-3">
                <div class="flex items-center">
                    <input type="checkbox" id="edit_modal_groepjes" ${r.sta_groepjes_toe !== false ? 'checked' : ''} class="w-4 h-4 text-blue-600 rounded">
                    <label class="ml-2 text-sm font-medium">Groepsinschrijvingen toestaan</label>
                </div>
                <div class="flex items-center">
                    <input type="checkbox" id="edit_modal_actief" ${r.is_actief ? 'checked' : ''} class="w-4 h-4 text-blue-600 rounded">
                    <label class="ml-2 text-sm font-medium">Activiteit is actief (Zichtbaar voor leerlingen)</label>
                </div>
            </div>
        `;
        document.getElementById('editModal').classList.remove('hidden');
    }

    // --- BESTEMMINGEN / OPTIES LOGICA ---
    async renderBestemmingen() {
        const tbody = document.getElementById('bestemmingenTableBody');
        if (!tbody) return;
        
        this.hotels = await window.dbApi.getHotels(false);
        tbody.innerHTML = '';

        this.hotels.forEach(h => {
            const tr = document.createElement('tr');
            tr.className = 'border-b hover:bg-gray-50 transition';
            
            const checkedState = h.is_actief ? 'checked' : '';
            const reisNaam = h.reis ? h.reis.naam : '<span class="text-red-500">Niet gekoppeld</span>'; 
            
            tr.innerHTML = `
                <td class="p-3 text-xs font-bold text-gray-500 uppercase">${reisNaam}</td>
                <td class="p-3 font-medium">${h.naam}</td>
                <td class="p-3 text-center">
                    <label class="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" ${checkedState} onchange="window.adminApp.toggleBestemming(${h.id}, this.checked)" class="sr-only peer">
                        <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500 shadow-sm"></div>
                    </label>
                </td>
                <td class="p-3 text-right">
                    <button onclick="window.adminApp.editHotel(${h.id})" class="text-blue-600 hover:underline mr-3 font-medium">Bewerk</button>
                    <button onclick="window.adminApp.deleteHotel(${h.id})" class="text-red-600 hover:underline font-medium">Verwijder</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    async addBestemming() {
        const submitBtn = document.querySelector('#addBestemmingForm button[type="submit"]');
        if (submitBtn && submitBtn.disabled) return; 
        
        const reis_id = document.getElementById('b_reis').value; 
        const naam = document.getElementById('b_naam').value;
        const fileInput = document.getElementById('b_foto');
        const file = fileInput.files[0];

        if (!file) return this.showAlert("Selecteer een overzichtsafbeelding.", "error");

        let origineleTekst = "Toevoegen";
        if (submitBtn) {
            submitBtn.disabled = true;
            origineleTekst = submitBtn.innerText;
            submitBtn.innerText = "Bezig...";
        }

        this.showAlert("Afbeelding wordt geüpload...", "info");

        const uploadRes = await window.dbApi.uploadAfbeelding(file);
        if (!uploadRes.success) {
            if(submitBtn) { submitBtn.disabled = false; submitBtn.innerText = origineleTekst; }
            return this.showAlert("Upload mislukt: " + uploadRes.message, "error");
        }

        const res = await window.dbApi.addHotel(reis_id, naam, uploadRes.url); 
        
        if(submitBtn) { submitBtn.disabled = false; submitBtn.innerText = origineleTekst; }
        
        if (res.success) {
            this.showAlert("Optie succesvol toegevoegd.", "success");
            document.getElementById('addBestemmingForm').reset();
            await this.init();
        } else {
            this.showAlert(res.message || "Fout bij het toevoegen.", "error");
        }
    }

    async deleteHotel(id) {
        if(confirm("Waarschuwing: Dit verwijdert deze optie en alle gekoppelde plaatsen/kamers. Doorgaan?")) {
            const res = await window.dbApi.deleteHotel(id);
            if(res.success) {
                this.showAlert("Optie verwijderd.", "info");
                await this.init();
            } else {
                this.showAlert(res.message, "error");
            }
        }
    }

    editHotel(id) {
        const h = this.hotels.find(x => x.id === id);
        if(!h) return;
        this.editContext = { type: 'hotel', id: id };
        
        let reisOptions = this.reizen.map(r => `<option value="${r.id}" ${h.reis_id === r.id ? 'selected' : ''}>${r.naam}</option>`).join('');

        document.getElementById('modalTitle').innerText = 'Optie Aanpassen';
        document.getElementById('modalFields').innerHTML = `
            <div>
                <label class="block text-sm font-medium mb-1">Gekoppelde Activiteit</label>
                <select id="edit_modal_reis" class="w-full p-2 border rounded bg-white">
                    ${reisOptions}
                </select>
            </div>
            <div>
                <label class="block text-sm font-medium mb-1">Naam / Titel</label>
                <input type="text" id="edit_modal_naam" value="${h.naam}" class="w-full p-2 border rounded">
            </div>
            <div>
                <label class="block text-sm font-medium mb-1">Nieuwe Overzichtsfoto (Optioneel)</label>
                <input type="file" id="edit_modal_foto" accept="image/*" class="w-full p-1.5 border rounded">
            </div>
        `;
        document.getElementById('editModal').classList.remove('hidden');
    }

    async toggleBestemming(id, isActief) {
        await window.dbApi.toggleHotelActief(id, isActief);
        this.showAlert(isActief ? "Optie is nu zichtbaar." : "Optie is verborgen.", "info");
        this.hotels = await window.dbApi.getHotels(false);
        this.populateHotelDropdowns();
    }

    // --- GENERIEKE MODAL LOGICA ---
    closeModal() {
        document.getElementById('editModal').classList.add('hidden');
        this.editContext = null;
    }

    async saveModal() {
        if(!this.editContext) return;
        
        const submitBtn = document.querySelector('#editModal button.bg-primary-600');
        if (submitBtn && submitBtn.disabled) return;
        
        const naam = document.getElementById('edit_modal_naam').value;
        const fileInput = document.getElementById('edit_modal_foto');
        let newPhotoUrl = null;

        let origineleTekst = "Bevestigen";
        if (submitBtn) {
            submitBtn.disabled = true;
            origineleTekst = submitBtn.innerText;
            submitBtn.innerText = "Bezig...";
        }

        if (fileInput && fileInput.files[0]) {
            this.showAlert("Nieuwe foto wordt geüpload...", "info");
            const uploadRes = await window.dbApi.uploadAfbeelding(fileInput.files[0]);
            if (uploadRes.success) {
                newPhotoUrl = uploadRes.url;
            } else {
                if (submitBtn) { submitBtn.disabled = false; submitBtn.innerText = origineleTekst; }
                return this.showAlert("Upload mislukt: " + uploadRes.message, "error");
            }
        }
        
        if (this.editContext.type === 'reis') {
            const slug = document.getElementById('edit_modal_slug').value;
            const isActief = document.getElementById('edit_modal_actief').checked;
            const groepjes = document.getElementById('edit_modal_groepjes').checked;

            // Uitlezen van geselecteerde klassen
            let klassen = '*';
            const allCbModal = document.getElementById('edit_modal_klassen_all');
            if (allCbModal && !allCbModal.checked) {
                const checkedOptions = Array.from(document.getElementsByName('edit_klas_optie')).filter(cb => cb.checked).map(cb => cb.value);
                klassen = checkedOptions.length > 0 ? checkedOptions.join(', ') : 'NIEMAND';
            }
            
            const res = await window.dbApi.updateReis(this.editContext.id, naam, slug, newPhotoUrl, isActief, klassen, groepjes);
            if(res.success) this.showAlert("Succesvol bijgewerkt.", "success");
            else this.showAlert(res.message, "error");
        } 
        else if (this.editContext.type === 'hotel') {
            const reisId = document.getElementById('edit_modal_reis').value;
            const res = await window.dbApi.updateHotel(this.editContext.id, naam, newPhotoUrl, reisId);
            if(res.success) this.showAlert("Succesvol bijgewerkt.", "success");
            else this.showAlert(res.message, "error");
        }

        if (submitBtn) { submitBtn.disabled = false; submitBtn.innerText = origineleTekst; }
        this.closeModal();
        await this.init();
    }

    // --- KAMERS / PLAATSEN LOGICA ---
    async renderKamers() {
        const tbody = document.getElementById('kamersTableBody');
        if (!tbody) return;
        
        const filterEl = document.getElementById('filter_k_hotel');
        const filterId = filterEl ? filterEl.value : null;

        const kamers = await window.dbApi.getAllKamersAdmin(filterId);
        tbody.innerHTML = '';

        kamers.forEach(k => {
            const hInfo = k.hotel;
            const hotelNaam = hInfo ? hInfo.naam : 'Onbekend';

            const tr = document.createElement('tr');
            tr.className = 'border-b hover:bg-gray-50';
            tr.innerHTML = `
                <td class="p-3 font-medium">${k.kamer_nr}</td>
                <td class="p-3 text-gray-600">${hotelNaam}</td>
                <td class="p-3">${k.geslacht === 'M' ? 'Jongens' : (k.geslacht === 'V' ? 'Meisjes' : 'Gemengd')}</td>
                <td class="p-3">${k.capaciteit} (Bezet: ${k.bezet})</td>
                <td class="p-3 text-right">
                    <button onclick="window.adminApp.openEditKamer(${k.id}, '${k.kamer_nr}', ${k.capaciteit}, '${k.geslacht}')" class="text-blue-500 hover:underline mr-3 font-medium">Bewerk</button>
                    ${k.bezet === 0 ? `<button onclick="window.adminApp.deleteKamer(${k.id})" class="text-red-500 hover:underline font-medium">Verwijder</button>` : '<span class="text-gray-400 text-xs italic">Bezet</span>'}
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    async addKamer() {
        const hotel = document.getElementById('k_hotel').value;
        const startNrTekst = document.getElementById('k_nr').value;
        const aantal = parseInt(document.getElementById('k_aantal').value) || 1;
        const geslacht = document.getElementById('k_geslacht').value;
        const cap = document.getElementById('k_cap').value;

        let match = startNrTekst.match(/^(.*?)(\d+)$/);
        let prefix = match ? match[1] : startNrTekst + " ";
        let startNummer = match ? parseInt(match[2]) : 1;

        let kamersArray = []; 

        for(let i = 0; i < aantal; i++) {
            let kamerNr = match ? prefix + (startNummer + i) : prefix + (i + 1);
            if(!match && aantal === 1) { kamerNr = startNrTekst; }
            kamersArray.push({
                hotel_id: parseInt(hotel),
                kamer_nr: kamerNr,
                geslacht: geslacht,
                capaciteit: parseInt(cap)
            });
        }

        await window.dbApi.addMeerdereKamers(kamersArray);
        this.showAlert(`${aantal} plaats(en) succesvol toegevoegd.`, "success");
        document.getElementById('addKamerForm').reset();
        this.renderKamers();
    }

    async deleteKamer(id) {
        if(confirm("Weet je zeker dat je deze lege plaats wilt verwijderen?")) {
            const res = await window.dbApi.deleteKamer(id);
            if(res.success) {
                this.showAlert("Plaats verwijderd.", "info");
                this.renderKamers();
            } else {
                this.showAlert(res.message, "error");
            }
        }
    }

    openEditKamer(id, nr, cap, geslacht) {
        document.getElementById('edit_k_id').value = id;
        document.getElementById('edit_k_nr').value = nr;
        document.getElementById('edit_k_cap').value = cap;
        document.getElementById('edit_k_geslacht').value = geslacht;
        document.getElementById('editKamerModal').classList.remove('hidden');
    }

    async saveKamerEdit() {
        const id = parseInt(document.getElementById('edit_k_id').value);
        const nr = document.getElementById('edit_k_nr').value;
        const cap = document.getElementById('edit_k_cap').value;
        const geslacht = document.getElementById('edit_k_geslacht').value;

        const res = await window.dbApi.updateKamer(id, nr, cap, geslacht);
        if(res.success) {
            document.getElementById('editKamerModal').classList.add('hidden');
            this.showAlert("Gegevens bijgewerkt.", "success");
            this.renderKamers();
        } else {
            this.showAlert(res.message, "error");
        }
    }

    // --- RESERVATIES LOGICA ---
    async renderReservaties() {
        const grid = document.getElementById('resGrid');
        if(!grid) return;
        const kamers = await window.dbApi.getAllKamersAdmin(); 
        grid.innerHTML = '';

        const bezetteKamers = kamers.filter(k => k.bezet > 0);

        if (bezetteKamers.length === 0) {
            grid.innerHTML = `<div class="col-span-2 p-8 text-center text-gray-500 bg-gray-50 rounded border border-gray-200">Er zijn nog geen inschrijvingen gemaakt.</div>`;
            return;
        }

        bezetteKamers.forEach(k => {
            const hInfo = k.hotel;
            const hotelNaam = hInfo ? hInfo.naam : 'Onbekend';

            const card = document.createElement('div');
            card.className = 'border border-gray-200 rounded-lg p-4 bg-white shadow-sm';
            
            let html = `
                <div class="flex justify-between items-center mb-4 border-b pb-2">
                    <h4 class="font-bold text-gray-800">${k.kamer_nr} <span class="text-xs font-normal text-gray-500 ml-2">(${hotelNaam} - ${k.geslacht})</span></h4>
                    <div class="flex items-center gap-2">
                        <span class="text-xs font-bold px-2 py-1 bg-gray-100 text-gray-600 rounded">${k.bezet}/${k.capaciteit}</span>
                        <button onclick="window.adminApp.kickKamer(${k.id})" class="text-xs text-red-500 hover:text-red-700 font-medium" title="Maak volledige groep leeg">Leegmaken</button>
                    </div>
                </div>
                <ul class="space-y-2">
            `;

            k.reservaties.forEach(r => {
                const user = r.gebruiker;
                const statusColor = r.status === 'confirmed' ? 'text-green-600' : 'text-orange-500';
                const klasTxt = user && user.klas && user.klas !== 'null' ? user.klas : '-';
                const naamWeergave = user ? `${user.vnaam} ${user.naam} (${klasTxt})` : 'Onbekend';
                
                html += `
                    <li class="flex justify-between items-center text-sm p-2 bg-gray-50 rounded border border-gray-100">
                        <div>
                            <span class="font-medium text-gray-800">${naamWeergave}</span>
                            <span class="text-xs ${statusColor} font-semibold ml-2">(${r.status})</span>
                        </div>
                        <button onclick="window.adminApp.kickUser('${r.id}')" class="text-xs bg-red-50 text-red-600 hover:bg-red-100 px-3 py-1 rounded font-medium transition border border-red-100">Verwijder</button>
                    </li>
                `;
            });

            html += `</ul>`;
            card.innerHTML = html;
            grid.appendChild(card);
        });
    }

    async kickUser(resId) {
        if(confirm("Inschrijving annuleren? Deze persoon verliest de plaats.")) {
            await window.dbApi.removeReservatieAdmin(resId);
            this.showAlert("Inschrijving verwijderd.", "info");
            this.renderReservaties();
        }
    }

    async kickKamer(kamerId) {
        if(confirm("Waarschuwing: Wil je IEDEREEN uit deze plaats verwijderen?")) {
            await window.dbApi.kickAllInKamer(kamerId);
            this.showAlert("Groep is leeggemaakt.", "info");
            this.renderReservaties();
        }
    }

    // --- LEERLINGEN LOGICA ---
    async renderLeerlingen() {
        const tbody = document.getElementById('leerlingenTableBody');
        if(!tbody) return;
        const leerlingen = await window.dbApi.getAllLeerlingen();
        const { data: alleReservaties } = await window.dbApi.supabaseClient.from('reservering').select('*');
        
        const filterEl = document.getElementById('filter_l_klas');
        let selectedKlas = filterEl ? filterEl.value : '';

        if (filterEl && filterEl.options.length <= 1) {
            const uniekeKlassen = [...new Set(leerlingen.map(l => l.klas))].filter(k => k && k !== 'null' && k !== '-').sort();
            filterEl.innerHTML = '<option value="">--- Alle klassen ---</option>';
            uniekeKlassen.forEach(k => {
                filterEl.innerHTML += `<option value="${k}">${k}</option>`;
            });
            filterEl.value = selectedKlas;
        }

        let gefilterdeLeerlingen = leerlingen;
        if (selectedKlas && selectedKlas !== '') {
            gefilterdeLeerlingen = leerlingen.filter(l => l.klas === selectedKlas);
        }

        tbody.innerHTML = '';
        gefilterdeLeerlingen.sort((a, b) => a.naam.localeCompare(b.naam));

        gefilterdeLeerlingen.forEach(l => {
            const userRes = (alleReservaties || []).filter(r => r.persoon_id === l.id && r.status === 'confirmed');
            let statusHtml;
            if (userRes.length >= 2) {
                statusHtml = `<span class="px-2 py-1 bg-green-50 text-green-700 text-xs rounded border border-green-200 font-medium">Meerdere Inschrijvingen</span>`;
            } else if (userRes.length === 1) {
                statusHtml = `<span class="px-2 py-1 bg-green-50 text-green-700 text-xs rounded border border-green-200 font-medium">Ingeschreven</span>`;
            } else {
                statusHtml = `<span class="px-2 py-1 bg-gray-50 text-gray-500 text-xs rounded border border-gray-200 font-medium">Nog niet</span>`;
            }
            const hasRes = userRes.length > 0;

            const geslachtTxt = l.geslacht ? (l.geslacht === 'M' ? 'Jongen' : 'Meisje') : '<span class="text-gray-400 italic text-xs">Onbekend</span>';
            const klasTxt = l.klas && l.klas !== 'null' ? l.klas : '-';
            const rolTxt = l.rol === 'LEERKRACHT' || l.rol === 'LK' ? '<span class="text-purple-600 font-medium text-xs bg-purple-50 px-2 py-1 rounded border border-purple-100">Leerkracht</span>' : '<span class="text-blue-600 font-medium text-xs">Student</span>';

            const naamWeergave = `${l.naam} ${l.vnaam} (${klasTxt})`;

            const tr = document.createElement('tr');
            tr.className = 'border-b hover:bg-gray-50';
            tr.innerHTML = `
                <td class="p-3 font-medium text-gray-800">${naamWeergave}</td>
                <td class="p-3 text-gray-600">${klasTxt}</td>
                <td class="p-3">${rolTxt}</td>
                <td class="p-3">${geslachtTxt}</td>
                <td class="p-3">${statusHtml}</td>
                <td class="p-3 text-right">
                    <button onclick="window.adminApp.openEditLeerling(${l.id}, '${l.vnaam}', '${l.naam}', '${l.geslacht}', '${l.klas}')" class="text-blue-600 hover:underline mr-3 font-medium">Bewerk</button>
                    ${!hasRes ? `<button onclick="window.adminApp.deleteLeerling('${l.id}')" class="text-red-600 hover:underline font-medium">Verwijder</button>` : '<span class="text-gray-400 text-xs italic" title="Deze persoon heeft actieve reservaties">Bezet</span>'}
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    openEditLeerling(id, vnaam, naam, geslacht, klas) {
        this.editContext = { type: 'leerling', id: id };
        document.getElementById('modalTitle').innerText = 'Persoon Aanpassen';
        document.getElementById('modalFields').innerHTML = `
            <div class="flex gap-2">
                <div class="flex-1">
                    <label class="block text-sm font-medium mb-1">Voornaam</label>
                    <input type="text" id="edit_modal_vnaam" value="${vnaam}" class="w-full p-2 border rounded">
                </div>
                <div class="flex-1">
                    <label class="block text-sm font-medium mb-1">Achternaam</label>
                    <input type="text" id="edit_modal_naam" value="${naam}" class="w-full p-2 border rounded">
                </div>
            </div>
            <div class="flex gap-2 mt-3">
                <div class="flex-1">
                    <label class="block text-sm font-medium mb-1">Geslacht</label>
                    <select id="edit_modal_geslacht" class="w-full p-2 border rounded bg-white">
                        <option value="M" ${geslacht === 'M' ? 'selected' : ''}>Jongen (M)</option>
                        <option value="V" ${geslacht === 'V' ? 'selected' : ''}>Meisje (V)</option>
                    </select>
                </div>
                <div class="flex-1">
                    <label class="block text-sm font-medium mb-1">Klas</label>
                    <input type="text" id="edit_modal_klas" value="${klas !== 'null' ? klas : ''}" class="w-full p-2 border rounded">
                </div>
            </div>
        `;
        
        const oldSave = this.saveModal.bind(this);
        this.saveModal = async () => {
            if(this.editContext && this.editContext.type === 'leerling') {
                const vn = document.getElementById('edit_modal_vnaam').value;
                const n = document.getElementById('edit_modal_naam').value;
                const g = document.getElementById('edit_modal_geslacht').value;
                const k = document.getElementById('edit_modal_klas').value;
                
                const res = await window.dbApi.updateLeerling(this.editContext.id, vn, n, g, k);
                if(res.success) {
                    this.showAlert("Persoon succesvol aangepast.", "success");
                    this.closeModal();
                    this.renderLeerlingen();
                } else {
                    this.showAlert("Fout bij aanpassen persoon.", "error");
                }
                this.saveModal = oldSave;
            } else {
                oldSave();
            }
        };
        
        document.getElementById('editModal').classList.remove('hidden');
    }

    handleCSVUpload() {
        const fileInput = document.getElementById('csvFileInput');
        const file = fileInput.files[0];
        if (!file) {
            this.showAlert("Selecteer eerst een CSV bestand.", "error");
            return;
        }

        const reader = new FileReader();
        reader.onload = async (e) => {
            const text = e.target.result;
            const res = await window.dbApi.importCSVLeerlingen(text);
            if (res.success) {
                this.showAlert(`Succes! ${res.count} personen geïmporteerd.`, "success");
                fileInput.value = ''; 
                // Vul de klassenlijst opnieuw met de nieuwe data
                this.populateKlassenCheckboxes();
                this.renderLeerlingen();
            } else {
                this.showAlert(res.message, "error");
            }
        };
        reader.readAsText(file);
    }

    async addLeerling() {
        const vnaam = document.getElementById('l_vnaam').value;
        const naam = document.getElementById('l_naam').value;
        const geslacht = document.getElementById('l_geslacht').value;
        
        const klasInput = document.getElementById('l_klas');
        const rolInput = document.getElementById('l_rol');
        
        const klas = klasInput ? klasInput.value : '-';
        const rol = rolInput ? rolInput.value : 'LEERLING';

        await window.dbApi.addLeerling(vnaam, naam, geslacht, klas, rol);
        this.showAlert("Persoon succesvol toegevoegd.", "success");
        document.getElementById('addLeerlingForm').reset();
        this.populateKlassenCheckboxes();
        this.renderLeerlingen();
    }

    async deleteLeerling(id) {
        if(confirm("Persoon volledig verwijderen uit het systeem?")) {
            const res = await window.dbApi.deleteLeerling(id);
            if(res.success) {
                this.showAlert("Persoon verwijderd.", "info");
                this.populateKlassenCheckboxes();
                this.renderLeerlingen();
            } else {
                this.showAlert(res.message, "error");
            }
        }
    }

    // --- EXPORT LOGICA ---
    async exportKamersExcel() {
        if (!window.ExcelJS) {
            return this.showAlert("Systeem is nog aan het laden, probeer het zo opnieuw.", "error");
        }

        const exportReisSelect = document.getElementById('export_reis_filter');
        const geselecteerdeReisId = exportReisSelect && exportReisSelect.value !== "" ? parseInt(exportReisSelect.value) : null;

        let kamers = await window.dbApi.getAllKamersAdmin();
        if (!kamers || kamers.length === 0) return this.showAlert("Er zijn geen gegevens om te exporteren.", "error");

        let relevanteHotels = this.hotels;
        if (geselecteerdeReisId) {
            relevanteHotels = this.hotels.filter(h => h.reis_id === geselecteerdeReisId);
            const hotelIds = relevanteHotels.map(h => h.id);
            kamers = kamers.filter(k => hotelIds.includes(k.hotelid));
        }

        if (kamers.length === 0) return this.showAlert("Geen inschrijvingen gevonden voor deze selectie.", "error");

        this.showAlert("Excel-export wordt voorbereid...", "info");

        const actieveReis = geselecteerdeReisId ? this.reizen.find(r => r.id === geselecteerdeReisId) : (this.reizen.length > 0 ? this.reizen[0] : null);
        const actieveReisNaam = actieveReis ? actieveReis.naam : "Export Alle Activiteiten";

        const kamersPerHotel = {};
        relevanteHotels.forEach(h => kamersPerHotel[h.id] = { naam: h.naam, kamers: [] });
        kamers.forEach(k => {
            if (kamersPerHotel[k.hotelid]) kamersPerHotel[k.hotelid].kamers.push(k);
        });
        const hotelIds = Object.keys(kamersPerHotel).filter(id => kamersPerHotel[id].kamers.length > 0);

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Verdeling');

        sheet.mergeCells('A1:I2');
        const titleCell = sheet.getCell('A1');
        titleCell.value = actieveReisNaam.toUpperCase();
        titleCell.font = { size: 16, bold: true, color: { argb: 'FF1F2937' } };
        titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
        titleCell.alignment = { vertical: 'middle', horizontal: 'center' };

        let rowTrackers = [4, 4]; 
        
        hotelIds.forEach((hotelId, index) => {
            const side = index % 2;
            let currentRow = rowTrackers[side];
            const colStart = side === 0 ? 1 : 6;

            sheet.mergeCells(currentRow, colStart, currentRow, colStart + 3);
            const hTitle = sheet.getCell(currentRow, colStart);
            hTitle.value = kamersPerHotel[hotelId].naam;
            hTitle.font = { size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
            hTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF374151' } }; 
            hTitle.alignment = { horizontal: 'center' };
            currentRow++;

            const headers = ['Optie/Plaats', 'Cap.', 'Bezet', 'Namen Deelnemers'];
            headers.forEach((h, i) => {
                const cell = sheet.getCell(currentRow, colStart + i);
                cell.value = h;
                cell.font = { bold: true, color: { argb: 'FF4B5563' } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
                cell.border = { bottom: { style: 'thin' } };
            });
            currentRow++;

            kamersPerHotel[hotelId].kamers.forEach(k => {
                const namen = k.reservaties.map(r => {
                    if (!r.gebruiker) return '?';
                    const klas = r.gebruiker.klas && r.gebruiker.klas !== 'null' ? r.gebruiker.klas : '-';
                    return `${r.gebruiker.vnaam} ${r.gebruiker.naam} (${klas})`;
                }).join(', ');
                
                const rowData = [ k.kamer_nr, k.capaciteit, k.bezet, namen ];
                const bgColor = k.geslacht === 'M' ? 'FFE0F2FE' : 'FFFCE7F3'; 

                rowData.forEach((val, i) => {
                    const cell = sheet.getCell(currentRow, colStart + i);
                    cell.value = val;
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
                    cell.border = { bottom: { style: 'hair', color: { argb: 'FFD1D5DB' } } };
                    
                    if (i < 3) cell.alignment = { horizontal: 'center' };
                });
                currentRow++;
            });

            currentRow += 2; 
            rowTrackers[side] = currentRow; 
        });

        sheet.getColumn(1).width = 12; 
        sheet.getColumn(2).width = 8; 
        sheet.getColumn(3).width = 8; 
        sheet.getColumn(4).width = 50;  
        sheet.getColumn(5).width = 3;  
        sheet.getColumn(6).width = 12; 
        sheet.getColumn(7).width = 8; 
        sheet.getColumn(8).width = 8; 
        sheet.getColumn(9).width = 50; 

        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `Export_${actieveReisNaam.replace(/\s+/g, '_')}.xlsx`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        this.showAlert("Excel-export succesvol voltooid.", "success");
    }

    // --- INSTELLINGEN ---
    async changePassword() {
        const oldPw = document.getElementById('pw_old').value;
        const newPw = document.getElementById('pw_new').value;
        const confirmPw = document.getElementById('pw_confirm').value;

        if (newPw !== confirmPw) return this.showAlert('Nieuwe wachtwoorden komen niet overeen.', 'error');
        if (newPw.length < 6) return this.showAlert('Het wachtwoord moet minimaal 6 tekens bevatten.', 'error');

        const success = await window.dbApi.updateTeacherPassword(oldPw, newPw);
        if (success) {
            this.showAlert('Wachtwoord succesvol gewijzigd.', 'success');
            document.getElementById('changePasswordForm').reset();
        } else {
            this.showAlert('Huidig wachtwoord is onjuist.', 'error');
        }
    }

    copyLink(link) {
        navigator.clipboard.writeText(link).then(() => {
            this.showAlert("Link gekopieerd naar klembord.", "success");
        }).catch(err => {
            this.showAlert("Kon link niet kopiëren.", "error");
        });
    }

    logout() {
        const user = this.user;
        let redirectUrl = 'login.html';
        
        if (user && user.school_slug && user.reis_slug) {
            redirectUrl = `login.html?school=${user.school_slug}&reis=${user.reis_slug}`;
        }
        
        window.dbApi.logout();
        window.location.href = redirectUrl;
    }

    showAlert(msg, type) {
        const box = document.getElementById('alertBox');
        if(!box) return;
        box.innerText = msg;
        box.className = 'mb-6 p-4 rounded-xl border block transition-opacity font-medium shadow-sm z-50';
        
        if (type === 'success') box.classList.add('bg-green-50', 'text-green-800', 'border-green-200');
        else if (type === 'error') box.classList.add('bg-red-50', 'text-red-800', 'border-red-200');
        else if (type === 'info') box.classList.add('bg-blue-50', 'text-blue-800', 'border-blue-200');

        setTimeout(() => {
            box.classList.add('hidden');
            box.className = 'hidden mb-6 p-4 rounded-xl border'; 
        }, 3000);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.adminApp = new AdminApp();
});

// Functie om de instellingen op te halen en door te sturen naar je backend
function slaActiviteitInstellingenOp() {
    // Lees de statussen van de checkboxes uit (geeft true of false terug)
    const allowSmartschool = document.getElementById('toggle_smartschool').checked;
    const allowManual = document.getElementById('toggle_manual').checked;
    const requireGender = document.getElementById('toggle_gender').checked;

    // Maak een data-object aan voor de backend (bijv. PHP of direct naar de DB)
    const activiteitData = {
        // ... je andere data (zoals naam, datum, etc.)
        allow_smartschool_login: allowSmartschool,
        allow_manual_login: allowManual,
        require_gender: requireGender
    };

    console.log("Te verzenden instellingen:", activiteitData);

    // Voorbeeld van een fetch request naar je PHP backend
    /*
    fetch('api/save_activiteit.php', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(activiteitData)
    })
    .then(response => response.json())
    .then(data => {
        if(data.success) {
            alert('Instellingen succesvol opgeslagen!');
        }
    })
    .catch(error => console.error('Fout bij opslaan:', error));
    */
}

document.addEventListener('DOMContentLoaded', () => {
    // Event listener voor het tonen/verbergen van de publicatiedatum
    const toggleVisibility = document.getElementById('toggle_visibility');
    const containerDatumOnline = document.getElementById('container_datum_online');

    if (toggleVisibility && containerDatumOnline) {
        toggleVisibility.addEventListener('change', function() {
            if (this.checked) {
                // Direct zichtbaar AAN = verberg planningsdatum
                containerDatumOnline.classList.add('hidden');
                document.getElementById('input_datum_online').value = ''; // Maak veld leeg
            } else {
                // Direct zichtbaar UIT = toon planningsdatum
                containerDatumOnline.classList.remove('hidden');
            }
        });
    }
});

// Voeg deze logica toe aan je bestaande opslag-functie
function verzamelZichtbaarheidData() {
    const isDirectZichtbaar = document.getElementById('toggle_visibility').checked;
    const datumOnline = document.getElementById('input_datum_online').value;
    const datumSluiting = document.getElementById('input_datum_sluiting').value;
    const isForceClosed = document.getElementById('toggle_force_close').checked;

    // Basis Front-end Validatie
    if (!datumSluiting) {
        alert("Een sluitingsdatum is verplicht!");
        return false; // Stop het opslaan
    }

    if (!isDirectZichtbaar && !datumOnline) {
        alert("Je hebt aangegeven dat de activiteit niet direct zichtbaar is. Kies dan een geplande publicatiedatum.");
        return false; // Stop het opslaan
    }

    if (!isDirectZichtbaar && datumOnline && new Date(datumOnline) >= new Date(datumSluiting)) {
        alert("De publicatiedatum kan niet na de sluitingsdatum vallen.");
        return false; // Stop het opslaan
    }

    // Return the data object to merge with the rest of your form data
    return {
        is_direct_zichtbaar: isDirectZichtbaar,
        datum_online: isDirectZichtbaar ? null : datumOnline, 
        datum_sluiting: datumSluiting,
        is_force_closed: isForceClosed
    };
}

// Voeg deze functie toe aan je formulier-afhandeling in admin.js
function verzamelReisPeriodeData() {
    const startDatum = document.getElementById('input_reis_start').value;
    const eindDatum = document.getElementById('input_reis_eind').value;

    // Controleer of beide datums zijn ingevuld (omdat ze verplicht zijn)
    if (!startDatum || !eindDatum) {
        if (window.adminApp) {
            window.adminApp.showAlert("Zowel de startdatum als de einddatum van de reis zijn verplicht!", "error");
        } else {
            alert("Zowel de startdatum als de einddatum van de reis zijn verplicht!");
        }
        return false;
    }

    // Controleer of de startdatum chronologisch vóór of op de einddatum ligt
    if (new Date(startDatum) > new Date(eindDatum)) {
        if (window.adminApp) {
            window.adminApp.showAlert("Fout: De startdatum van de reis kan niet na de einddatum liggen.", "error");
        } else {
            alert("Fout: De startdatum van de reis kan niet na de einddatum liggen.");
        }
        return false;
    }

    // Geef de datums terug om te combineren met de rest van het addReis / updateReis object
    return {
        start_datum: startDatum,
        eind_datum: eindDatum
    };
}

function verzamelInschrijvingFaseData() {
    const inschrijvingStart = document.getElementById('input_inschrijving_start').value;
    const isBevroren = document.getElementById('toggle_freeze_registrations').checked;

    // Controleer of de openstellingsdatum is ingevuld
    if (!inschrijvingStart) {
        if (window.adminApp) {
            window.adminApp.showAlert("De startdatum voor de kamerindeling is verplicht!", "error");
        } else {
            alert("De startdatum voor de kamerindeling is verplicht!");
        }
        return false;
    }

    // Valideer met de sluitingsdatum uit stap 3
    const datumSluiting = document.getElementById('input_datum_sluiting') ? document.getElementById('input_datum_sluiting').value : null;
    if (datumSluiting && new Date(inschrijvingStart) >= new Date(datumSluiting)) {
        if (window.adminApp) {
            window.adminApp.showAlert("Fout: De startdatum van de inschrijvingen moet vóór de sluitingsdatum liggen.", "error");
        } else {
            alert("Fout: De startdatum van de inschrijvingen moet vóór de sluitingsdatum liggen.");
        }
        return false;
    }

    return {
        inschrijving_start: inschrijvingStart,
        is_bevroren: isBevroren
    };
}

function initDeelscholenTabs() {
    const tabEigen = document.getElementById('tab_btn_eigen_school');
    const tabDeel = document.getElementById('tab_btn_deelscholen');
    const panelEigen = document.getElementById('panel_eigen_school');
    const panelDeel = document.getElementById('panel_deelscholen');

    if (tabEigen && tabDeel) {
        tabEigen.addEventListener('click', () => {
            // Activeer tab
            tabEigen.className = "flex-1 py-2.5 text-xs font-bold border-r border-slate-200 bg-white text-primary-600 border-b-2 border-b-primary-500 transition";
            tabDeel.className = "flex-1 py-2.5 text-xs font-bold text-slate-500 hover:text-slate-800 hover:bg-slate-100/50 transition";
            // Wissel panels
            panelEigen.classList.remove('hidden');
            panelEigen.classList.add('flex');
            panelDeel.classList.add('hidden');
            panelDeel.classList.remove('flex');
        });

        tabDeel.addEventListener('click', () => {
            // Activeer tab
            tabDeel.className = "flex-1 py-2.5 text-xs font-bold bg-white text-primary-600 border-b-2 border-b-primary-500 transition";
            tabEigen.className = "flex-1 py-2.5 text-xs font-bold border-r border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-100/50 transition";
            // Wissel panels
            panelDeel.classList.remove('hidden');
            panelDeel.classList.add('flex');
            panelEigen.classList.add('hidden');
            panelEigen.classList.remove('flex');
            
            // Trigger herberekening van deelscholen-klassen indien nodig
            renderDeelscholenKlassenTree();
        });
    }
}

// Render-functie om klassen gestructureerd per deelschool te tonen
async function renderDeelscholenKlassenTree() {
    const container = document.getElementById('panel_deelscholen');
    if (!container) return;

    // Haal de geselecteerde deelscholen op uit de checkboxes
    const geselecteerdeDeelschoolIds = Array.from(document.querySelectorAll('input[name="r_gekoppelde_deelschool"]:checked')).map(cb => cb.value);

    if (geselecteerdeDeelschoolIds.length === 0) {
        container.innerHTML = '<span class="text-amber-500 italic text-xs p-2">Vink hierboven eerst aan welke deelscholen deelnemen aan dit evenement om hun jaren en klassen te zien.</span>';
        return;
    }

    // Voorbeeld data-fetch (Pas dit aan op basis van je database API)
    // const data = await window.dbApi.getKlassenVanDeelscholen(geselecteerdeDeelschoolIds);
    
    let html = '';
    
    // Simulatie van de groepering per deelschool voor weergave
    geselecteerdeDeelschoolIds.forEach(id => {
        html += `
            <div class="deelschool-sectie border border-slate-100 p-2 rounded bg-slate-50/50">
                <span class="block text-xs font-bold text-slate-700 border-b border-slate-200 pb-1 mb-2 uppercase tracking-wide">Campus ID: ${id}</span>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-1">
                    <label class="klas-item flex items-center gap-2 cursor-pointer p-1 hover:bg-white rounded transition" data-klas="6biw">
                        <input type="checkbox" name="r_klas_optie" value="DEEL_${id}_6BIW" class="w-3.5 h-3.5 text-primary-600 rounded border-slate-300">
                        <span class="text-slate-700 text-xs">6BIW</span>
                    </label>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

document.addEventListener('DOMContentLoaded', () => {
    initDeelscholenTabs();
    
    // Registreer de triggers bij veranderingen in deelscholen selectie
    document.querySelectorAll('input[name="r_gekoppelde_deelschool"]').forEach(cb => {
        cb.addEventListener('change', () => {
            if(document.getElementById('panel_deelscholen').style.display !== 'none') {
                renderDeelscholenKlassenTree();
            }
        });
    });
});

document.addEventListener('DOMContentLoaded', () => {
    const radioTypes = document.querySelectorAll('input[name="r_event_type"]');
    const containerHotelSettings = document.getElementById('container_hotel_settings');
    const inputGroepsgrootte = document.getElementById('input_groepsgrootte');

    if (radioTypes.length > 0 && containerHotelSettings) {
        radioTypes.forEach(radio => {
            radio.addEventListener('change', (e) => {
                if (e.target.value === 'activiteit') {
                    // Verberg kamer/groep instellingen
                    containerHotelSettings.style.display = 'none';
                } else {
                    // Toon kamer/groep instellingen
                    containerHotelSettings.style.display = 'block';
                }
            });
        });
    }
});

// Voeg dit toe aan je opslag-functie
function verzamelEventTypeData() {
    const eventType = document.querySelector('input[name="r_event_type"]:checked').value;
    
    // Als het een activiteit is, is de groepsgrootte altijd exact 1 (alleen jezelf)
    // Als het een hotel is, haal dan de waarde uit het invulveld
    const groepsgrootte = (eventType === 'activiteit') 
        ? 1 
        : parseInt(document.getElementById('input_groepsgrootte').value, 10);

    return {
        type: eventType, // 'hotel' of 'activiteit'
        max_personen_per_groep: groepsgrootte
    };
}

// Functie om de herhalingsdata te verzamelen
function verzamelHerhalingData() {
    const frequentie = document.getElementById('select_herhaling').value;

    return {
        herhaling_frequentie: frequentie
    };
}
