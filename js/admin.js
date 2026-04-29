// admin.js - Logica voor het Admin Paneel

class AdminApp {
    constructor() {
        this.user = window.dbApi.getCurrentUser();
        if (!this.user || !this.user.isLeerkracht) {
            alert("Toegang geweigerd. Alleen voor leerkrachten.");
            window.location.href = 'login.html';
            return;
        }

        this.currentTab = 'reizen'; 
        this.hotels = [];
        this.reizen = []; 
        this.editContext = null; // Voor het generieke modal
        this.init();
    }

    async init() {
        document.getElementById('userInfo').innerText = `Admin: ${this.user.vnaam} ${this.user.naam}`;
        
        const settings = await window.dbApi.getAppSettings();
        if (settings.app_title) {
            if (document.getElementById('navTitle')) document.getElementById('navTitle').innerText = settings.app_title + " Admin";
            if (document.getElementById('pageTitle')) document.title = settings.app_title + " Admin";
        }

        this.reizen = await window.dbApi.getReizen(false);
        this.hotels = await window.dbApi.getHotels(false);
        
        this.populateReisDropdown(); 
        this.populateHotelDropdowns();

        this.setTab(this.currentTab);

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
            this.refreshCurrentTab();
        }, 3000);
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
            // Voeg optie toe om alle hotels te tonen
            const allOpt = document.createElement('option');
            allOpt.value = "";
            allOpt.innerText = "--- Toon alle hotels ---";
            selectFilter.appendChild(allOpt);
        }

        this.hotels.forEach(h => {
            const reisNaam = h.reis ? h.reis.naam : 'Geen Reis'; 
            
            // Voor het toevoegen van een kamer
            if(selectAdd) {
                const optAdd = document.createElement('option');
                optAdd.value = h.id;
                optAdd.innerText = `${h.naam} (${reisNaam})`; 
                selectAdd.appendChild(optAdd);
            }
            
            // Voor het filteren van kamers
            if(selectFilter) {
                const optFilter = document.createElement('option');
                optFilter.value = h.id;
                optFilter.innerText = `${h.naam} (${reisNaam})`; 
                selectFilter.appendChild(optFilter);
            }
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

    // --- REIZEN LOGICA (MET UPLOAD & EDIT/DELETE) ---
    async renderReizen() {
        const tbody = document.getElementById('reizenTableBody');
        if (!tbody) return;
        
        this.reizen = await window.dbApi.getReizen(false);
        tbody.innerHTML = '';

        // Slimme truc om het GitHub Pages "mapje" (repository naam) te behouden
        let baseUrl = window.location.href.split('admin.html')[0];

        this.reizen.forEach(r => {
            const tr = document.createElement('tr');
            tr.className = 'border-b hover:bg-gray-50 transition';
            
            // Nu maken we de link met de correcte baseUrl
            const fullLink = `${baseUrl}login.html?reis=${r.slug}`;

            tr.innerHTML = `
                <td class="p-3 font-bold">${r.naam}</td>
                <td class="p-3 text-sm text-gray-500">${r.slug}</td>
                <td class="p-3"><button onclick="window.adminApp.copyLink('${fullLink}')" class="text-xs bg-gray-100 hover:bg-gray-200 p-1.5 rounded border border-gray-300 transition">Kopieer Link</button></td>
                <td class="p-3 text-right">
                    <button onclick="window.adminApp.editReis(${r.id})" class="text-blue-600 hover:underline mr-3 font-medium">Bewerk</button>
                    <button onclick="window.adminApp.deleteReis(${r.id})" class="text-red-600 hover:underline font-medium">Sloop</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    async addReis() {
        const naam = document.getElementById('r_naam').value;
        const slug = document.getElementById('r_slug').value;
        const fileInput = document.getElementById('r_foto');
        const file = fileInput.files[0];
        
        if (!file) return this.showAlert("Je moet een afbeelding selecteren.", "error");

        this.showAlert("Foto aan het uploaden... één momentje alstublieft.", "info");

        const uploadRes = await window.dbApi.uploadAfbeelding(file);
        if (!uploadRes.success) return this.showAlert("Fout bij het uploaden van de foto: " + uploadRes.message, "error");

        const res = await window.dbApi.addReis(naam, slug, uploadRes.url);
        
        if (res.success) {
            this.showAlert("Reis inclusief inlogfoto toegevoegd!", "success");
            document.getElementById('addReisForm').reset();
            await this.init(); 
        } else {
            this.showAlert(res.message || "Fout bij opslaan in database.", "error");
        }
    }

    async deleteReis(id) {
        if(confirm("LET OP: Dit verwijdert de hele reis en ALLE hotels, kamers en reservaties die erbij horen! Zeker weten?")) {
            const res = await window.dbApi.deleteReis(id);
            if(res.success) {
                this.showAlert("Reis verwijderd.", "info");
                await this.init();
            } else {
                this.showAlert(res.message, "error");
            }
        }
    }

    editReis(id) {
        const r = this.reizen.find(x => x.id === id);
        if(!r) return;
        this.editContext = { type: 'reis', id: id };
        
        document.getElementById('modalTitle').innerText = 'Reis Aanpassen';
        document.getElementById('modalFields').innerHTML = `
            <div>
                <label class="block text-sm font-medium mb-1">Naam</label>
                <input type="text" id="edit_modal_naam" value="${r.naam}" class="w-full p-2 border rounded">
            </div>
            <div>
                <label class="block text-sm font-medium mb-1">Unieke Slug</label>
                <input type="text" id="edit_modal_slug" value="${r.slug}" class="w-full p-2 border rounded">
            </div>
            <p class="text-xs text-gray-500 mt-2">Let op: Als je een nieuwe inlogfoto wilt, moet je de reis verwijderen en opnieuw toevoegen.</p>
        `;
        document.getElementById('editModal').classList.remove('hidden');
    }

    // --- BESTEMMINGEN LOGICA (MET UPLOAD & EDIT/DELETE) ---
    async renderBestemmingen() {
        const tbody = document.getElementById('bestemmingenTableBody');
        if (!tbody) return;
        
        this.hotels = await window.dbApi.getHotels(false);
        tbody.innerHTML = '';

        this.hotels.forEach(h => {
            const tr = document.createElement('tr');
            tr.className = 'border-b hover:bg-gray-50 transition';
            
            const checkedState = h.is_actief ? 'checked' : '';
            const reisNaam = h.reis ? h.reis.naam : '<span class="text-red-500">Geen</span>'; 
            
            tr.innerHTML = `
                <td class="p-3 text-xs font-bold text-gray-500 uppercase">${reisNaam}</td>
                <td class="p-3 font-bold">${h.naam}</td>
                <td class="p-3 text-center">
                    <label class="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" ${checkedState} onchange="window.adminApp.toggleBestemming(${h.id}, this.checked)" class="sr-only peer">
                        <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500 shadow-sm"></div>
                    </label>
                </td>
                <td class="p-3 text-right">
                    <button onclick="window.adminApp.editHotel(${h.id})" class="text-blue-600 hover:underline mr-3 font-medium">Bewerk</button>
                    <button onclick="window.adminApp.deleteHotel(${h.id})" class="text-red-600 hover:underline font-medium">Sloop</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    async addBestemming() {
        const reis_id = document.getElementById('b_reis').value; 
        const naam = document.getElementById('b_naam').value;
        const fileInput = document.getElementById('b_foto');
        const file = fileInput.files[0];

        if (!file) return this.showAlert("Je moet een dashboardfoto selecteren.", "error");

        this.showAlert("Foto aan het uploaden... één momentje alstublieft.", "info");

        const uploadRes = await window.dbApi.uploadAfbeelding(file);
        if (!uploadRes.success) return this.showAlert("Fout bij het uploaden van de foto: " + uploadRes.message, "error");

        const res = await window.dbApi.addHotel(reis_id, naam, uploadRes.url); 
        
        if (res.success) {
            this.showAlert("Bestemming/Hotel en dashboardfoto toegevoegd!", "success");
            document.getElementById('addBestemmingForm').reset();
            await this.init();
        } else {
            this.showAlert("Er ging iets mis bij het toevoegen.", "error");
        }
    }

    async deleteHotel(id) {
        if(confirm("LET OP: Dit verwijdert het hotel en ALLE kamers erin! Zeker weten?")) {
            const res = await window.dbApi.deleteHotel(id);
            if(res.success) {
                this.showAlert("Hotel verwijderd.", "info");
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
        
        document.getElementById('modalTitle').innerText = 'Hotel Aanpassen';
        document.getElementById('modalFields').innerHTML = `
            <div>
                <label class="block text-sm font-medium mb-1">Hotel Naam</label>
                <input type="text" id="edit_modal_naam" value="${h.naam}" class="w-full p-2 border rounded">
            </div>
            <p class="text-xs text-gray-500 mt-2">Let op: Als je een nieuwe dashboardfoto wilt, moet je het hotel verwijderen en opnieuw toevoegen.</p>
        `;
        document.getElementById('editModal').classList.remove('hidden');
    }

    async toggleBestemming(id, isActief) {
        await window.dbApi.toggleHotelActief(id, isActief);
        this.showAlert(isActief ? "Bestemming is nu zichtbaar!" : "Bestemming verborgen.", "info");
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
        
        const naam = document.getElementById('edit_modal_naam').value;
        
        if (this.editContext.type === 'reis') {
            const slug = document.getElementById('edit_modal_slug').value;
            const res = await window.dbApi.updateReis(this.editContext.id, naam, slug);
            if(res.success) this.showAlert("Reis succesvol aangepast.", "success");
            else this.showAlert(res.message, "error");
        } 
        else if (this.editContext.type === 'hotel') {
            const res = await window.dbApi.updateHotel(this.editContext.id, naam);
            if(res.success) this.showAlert("Hotel succesvol aangepast.", "success");
            else this.showAlert(res.message, "error");
        }

        this.closeModal();
        await this.init();
    }

    // --- KAMERS LOGICA (MET FILTER) ---
    async renderKamers() {
        const tbody = document.getElementById('kamersTableBody');
        if (!tbody) return;
        
        // Haal het geselecteerde hotel_id uit de filter dropdown
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
                <td class="p-3">${k.geslacht === 'M' ? 'Jongens' : 'Meisjes'}</td>
                <td class="p-3">${k.capaciteit} (Bezet: ${k.bezet})</td>
                <td class="p-3 text-right">
                    <button onclick="window.adminApp.openEditKamer(${k.id}, '${k.kamer_nr}', ${k.capaciteit}, '${k.geslacht}')" class="text-blue-500 hover:underline mr-3 font-medium">Bewerk</button>
                    ${k.bezet === 0 ? `<button onclick="window.adminApp.deleteKamer(${k.id})" class="text-red-500 hover:underline font-medium">Sloop</button>` : '<span class="text-gray-400 text-xs italic">Bezet</span>'}
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
        this.showAlert(`${aantal} kamer(s) succesvol toegevoegd!`, "success");
        document.getElementById('addKamerForm').reset();
        this.renderKamers();
    }

    async deleteKamer(id) {
        if(confirm("Weet je zeker dat je deze lege kamer wilt verwijderen?")) {
            const res = await window.dbApi.deleteKamer(id);
            if(res.success) {
                this.showAlert("Kamer verwijderd.", "info");
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
            this.showAlert("Kamer bijgewerkt.", "success");
            this.renderKamers();
        } else {
            this.showAlert(res.message, "error");
        }
    }

    // --- RESERVATIES LOGICA ---
    async renderReservaties() {
        const grid = document.getElementById('resGrid');
        if(!grid) return;
        const kamers = await window.dbApi.getAllKamersAdmin(); // Voor reservaties halen we alles op
        grid.innerHTML = '';

        const bezetteKamers = kamers.filter(k => k.bezet > 0);

        if (bezetteKamers.length === 0) {
            grid.innerHTML = `<div class="col-span-2 p-8 text-center text-gray-500 bg-gray-50 rounded border border-dashed">Er zijn nog geen reservaties gemaakt.</div>`;
            return;
        }

        bezetteKamers.forEach(k => {
            const hInfo = k.hotel;
            const hotelNaam = hInfo ? hInfo.naam : 'Onbekend';

            const card = document.createElement('div');
            card.className = 'border border-gray-200 rounded-lg p-4 bg-white shadow-sm';
            
            let html = `
                <div class="flex justify-between items-center mb-4 border-b pb-2">
                    <h4 class="font-bold text-gray-800">Kamer ${k.kamer_nr} <span class="text-xs font-normal text-gray-500 ml-2">(${hotelNaam} - ${k.geslacht})</span></h4>
                    <span class="text-xs font-bold px-2 py-1 bg-gray-100 text-gray-600 rounded">${k.bezet}/${k.capaciteit}</span>
                </div>
                <ul class="space-y-2">
            `;

            k.reservaties.forEach(r => {
                const user = r.gebruiker;
                const statusColor = r.status === 'confirmed' ? 'text-green-600' : 'text-orange-500';
                
                html += `
                    <li class="flex justify-between items-center text-sm p-2 bg-gray-50 rounded border border-gray-100">
                        <div>
                            <span class="font-medium text-gray-800">${user ? user.vnaam + ' ' + user.naam : 'Onbekend'}</span>
                            <span class="text-xs ${statusColor} font-semibold ml-2">(${r.status})</span>
                        </div>
                        <button onclick="window.adminApp.kickUser('${r.id}')" class="text-xs bg-red-100 text-red-600 hover:bg-red-200 px-3 py-1 rounded font-medium transition">Verwijder</button>
                    </li>
                `;
            });

            html += `</ul>`;
            card.innerHTML = html;
            grid.appendChild(card);
        });
    }

    async kickUser(resId) {
        if(confirm("Weet je zeker dat je deze reservatie wilt verwijderen? De leerling verliest zijn plaats in deze kamer.")) {
            await window.dbApi.removeReservatieAdmin(resId);
            this.showAlert("Reservatie verwijderd. De plaats is nu vrij.", "info");
            this.renderReservaties();
        }
    }

    // --- LEERLINGEN LOGICA ---
    async renderLeerlingen() {
        const tbody = document.getElementById('leerlingenTableBody');
        if(!tbody) return;
        const leerlingen = await window.dbApi.getAllLeerlingen();
        const { data: alleReservaties } = await window.dbApi.supabaseClient.from('reservering').select('*');
        
        tbody.innerHTML = '';
        leerlingen.sort((a, b) => a.naam.localeCompare(b.naam));

        leerlingen.forEach(l => {
            const userRes = (alleReservaties || []).filter(r => r.persoon_id === l.id && r.status === 'confirmed');
            let statusHtml;
            if (userRes.length >= 2) {
                statusHtml = `<span class="px-2 py-1 bg-green-100 text-green-700 text-xs rounded font-bold">Volledig in orde</span>`;
            } else if (userRes.length === 1) {
                statusHtml = `<span class="px-2 py-1 bg-yellow-100 text-yellow-700 text-xs rounded font-bold">1 reservatie</span>`;
            } else {
                statusHtml = `<span class="px-2 py-1 bg-gray-100 text-gray-500 text-xs rounded font-bold">Nog niet</span>`;
            }
            const hasRes = userRes.length > 0;

            const geslachtTxt = l.geslacht ? (l.geslacht === 'M' ? 'Jongen' : 'Meisje') : '<span class="text-gray-400 italic text-xs">Onbekend</span>';
            const klasTxt = l.klas || '-';
            const rolTxt = l.rol === 'LEERKRACHT' || l.rol === 'LK' ? '<span class="text-purple-600 font-bold text-xs bg-purple-50 px-2 py-1 rounded border border-purple-100">Leerkracht</span>' : '<span class="text-blue-600 font-medium text-xs">Leerling</span>';

            const tr = document.createElement('tr');
            tr.className = 'border-b hover:bg-gray-50';
            tr.innerHTML = `
                <td class="p-3 font-medium text-gray-800">${l.naam} ${l.vnaam}</td>
                <td class="p-3 text-gray-600">${klasTxt}</td>
                <td class="p-3">${rolTxt}</td>
                <td class="p-3">${geslachtTxt}</td>
                <td class="p-3">${statusHtml}</td>
                <td class="p-3 text-right">
                    ${!hasRes ? `<button onclick="window.adminApp.deleteLeerling('${l.id}')" class="text-red-500 hover:underline font-medium">Sloop</button>` : '<span class="text-gray-400 text-xs italic">Beveiligd (Bezet)</span>'}
                </td>
            `;
            tbody.appendChild(tr);
        });
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

        await window.dbApi.addLeerling(vnaam, naam, geslacht);
        this.showAlert("Leerling toegevoegd!", "success");
        document.getElementById('addLeerlingForm').reset();
        this.renderLeerlingen();
    }

    async deleteLeerling(id) {
        if(confirm("Leerling volledig verwijderen uit de database?")) {
            const res = await window.dbApi.deleteLeerling(id);
            if(res.success) {
                this.showAlert("Leerling verwijderd.", "info");
                this.renderLeerlingen();
            } else {
                this.showAlert(res.message, "error");
            }
        }
    }

    // --- ECHTE EXCEL (.xlsx) EXPORT LOGICA ---
    async exportKamersExcel() {
        if (!window.ExcelJS) {
            return this.showAlert("Excel bibliotheek is nog aan het inladen, probeer het zo nog eens.", "error");
        }

        const kamers = await window.dbApi.getAllKamersAdmin();
        if (!kamers || kamers.length === 0) return this.showAlert("Er zijn geen kamers om te exporteren.", "error");

        this.showAlert("Excel-bestand wordt opgemaakt...", "info");

        // We zoeken de eerste reis om als titel te gebruiken, of we gebruiken een standaard titel
        const actieveReisNaam = this.reizen.length > 0 ? this.reizen[0].naam : "Kamerverdeling Overzicht";

        const kamersPerHotel = {};
        this.hotels.forEach(h => kamersPerHotel[h.id] = { naam: h.naam, kamers: [] });
        kamers.forEach(k => {
            if (kamersPerHotel[k.hotelid]) kamersPerHotel[k.hotelid].kamers.push(k);
        });
        const hotelIds = Object.keys(kamersPerHotel).filter(id => kamersPerHotel[id].kamers.length > 0);

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Overzicht');

        sheet.mergeCells('A1:I2');
        const titleCell = sheet.getCell('A1');
        titleCell.value = actieveReisNaam.toUpperCase();
        titleCell.font = { size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
        titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFED8936' } };
        titleCell.alignment = { vertical: 'middle', horizontal: 'center' };

        let rowTrackers = [4, 4]; 
        
        hotelIds.forEach((hotelId, index) => {
            const side = index % 2;
            let currentRow = rowTrackers[side];
            const colStart = side === 0 ? 1 : 6;

            sheet.mergeCells(currentRow, colStart, currentRow, colStart + 3);
            const hTitle = sheet.getCell(currentRow, colStart);
            hTitle.value = kamersPerHotel[hotelId].naam;
            hTitle.font = { size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
            hTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4A5568' } };
            hTitle.alignment = { horizontal: 'center' };
            currentRow++;

            const headers = ['Kamer', 'Capaciteit', 'Bezet', 'Namen Leerlingen'];
            headers.forEach((h, i) => {
                const cell = sheet.getCell(currentRow, colStart + i);
                cell.value = h;
                cell.font = { bold: true };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
                cell.border = { bottom: { style: 'thin' } };
            });
            currentRow++;

            kamersPerHotel[hotelId].kamers.forEach(k => {
                const namen = k.reservaties.map(r => r.gebruiker ? `${r.gebruiker.vnaam} ${r.gebruiker.naam}` : '?').join(', ');
                const rowData = [ k.kamer_nr, k.capaciteit, k.bezet, namen ];

                const bgColor = k.geslacht === 'M' ? 'FFBEE3F8' : 'FFFED7E2'; 

                rowData.forEach((val, i) => {
                    const cell = sheet.getCell(currentRow, colStart + i);
                    cell.value = val;
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
                    cell.border = { bottom: { style: 'hair' }, right: { style: 'hair' }, left: {style: 'hair'}, top: {style: 'hair'} };
                    
                    if (i < 3) cell.alignment = { horizontal: 'center' };
                });
                currentRow++;
            });

            currentRow += 2; 
            rowTrackers[side] = currentRow; 
        });

        sheet.getColumn(1).width = 12; 
        sheet.getColumn(2).width = 10; 
        sheet.getColumn(3).width = 10; 
        sheet.getColumn(4).width = 40; 
        sheet.getColumn(5).width = 3;  
        sheet.getColumn(6).width = 12; 
        sheet.getColumn(7).width = 10; 
        sheet.getColumn(8).width = 10; 
        sheet.getColumn(9).width = 40; 

        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `Kamerverdeling_${actieveReisNaam.replace(/\s+/g, '_')}.xlsx`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        this.showAlert("Prachtig Excel-bestand succesvol gedownload!", "success");
    }

    // --- INSTELLINGEN LOGICA ---
    async changePassword() {
        const oldPw = document.getElementById('pw_old').value;
        const newPw = document.getElementById('pw_new').value;
        const confirmPw = document.getElementById('pw_confirm').value;

        if (newPw !== confirmPw) return this.showAlert('Nieuwe wachtwoorden komen niet overeen.', 'error');
        if (newPw.length < 6) return this.showAlert('Minimaal 6 tekens vereist.', 'error');

        const success = await window.dbApi.updateTeacherPassword(oldPw, newPw);
        if (success) {
            this.showAlert('Wachtwoord succesvol gewijzigd!', 'success');
            document.getElementById('changePasswordForm').reset();
        } else {
            this.showAlert('Huidig wachtwoord is onjuist.', 'error');
        }
    }

    copyLink(link) {
        navigator.clipboard.writeText(link).then(() => {
            this.showAlert("Link gekopieerd! Je kan deze nu plakken (bijv. in Smartschool).", "success");
        }).catch(err => {
            this.showAlert("Kon link niet kopiëren.", "error");
        });
    }

    logout() {
        window.dbApi.logout();
        window.location.href = 'login.html';
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
