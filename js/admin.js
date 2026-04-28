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
        this.populateHotelDropdown();

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

    populateHotelDropdown() {
        const select = document.getElementById('k_hotel');
        if(!select) return;
        select.innerHTML = '';
        this.hotels.forEach(h => {
            const reisNaam = h.reis ? h.reis.naam : 'Geen Reis'; 
            const opt = document.createElement('option');
            opt.value = h.id;
            opt.innerText = `${h.naam} (${reisNaam})`; 
            select.appendChild(opt);
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
        
        // BUG OPGELOST: 'reizen' staat nu netjes in deze array, waardoor hij verborgen wordt als je een ander tabblad kiest!
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

    // --- REIZEN LOGICA (MET UPLOAD) ---
    async renderReizen() {
        const tbody = document.getElementById('reizenTableBody');
        if (!tbody) return;
        
        this.reizen = await window.dbApi.getReizen(false);
        tbody.innerHTML = '';

        this.reizen.forEach(r => {
            const tr = document.createElement('tr');
            tr.className = 'border-b hover:bg-gray-50 transition';
            const checkedState = r.is_actief ? 'checked' : '';
            
            // Toon een klikbare 'Bekijk Foto' link als het een volledige URL is, anders gewoon de tekst
            const bgHtml = r.login_bg.startsWith('http') 
                ? `<a href="${r.login_bg}" target="_blank" class="text-blue-500 hover:underline">Bekijk Foto</a>` 
                : `<span class="text-gray-400">${r.login_bg}</span>`;

            tr.innerHTML = `
                <td class="p-3 text-gray-500">#${r.id}</td>
                <td class="p-3 font-bold">${r.naam}</td>
                <td class="p-3 text-xs">${bgHtml}</td>
                <td class="p-3 text-center">
                    <label class="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" ${checkedState} onchange="window.adminApp.toggleReis(${r.id}, this.checked)" class="sr-only peer">
                        <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-orange-500 shadow-sm"></div>
                    </label>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    async addReis() {
        const naam = document.getElementById('r_naam').value;
        const fileInput = document.getElementById('r_foto');
        const file = fileInput.files[0];
        
        if (!file) return this.showAlert("Je moet een afbeelding selecteren.", "error");

        this.showAlert("Foto aan het uploaden... één momentje alstublieft.", "info");

        // 1. Upload de foto eerst
        const uploadRes = await window.dbApi.uploadAfbeelding(file);
        if (!uploadRes.success) {
            return this.showAlert("Fout bij het uploaden van de foto: " + uploadRes.message, "error");
        }

        // 2. Bewaar de reis in de database met de link naar de foto
        const res = await window.dbApi.addReis(naam, uploadRes.url);
        
        if (res.success) {
            this.showAlert("Reis inclusief inlogfoto toegevoegd!", "success");
            document.getElementById('addReisForm').reset();
            await this.init(); 
        } else {
            this.showAlert("Fout bij opslaan in database.", "error");
        }
    }

    async toggleReis(id, isActief) {
        if (!isActief) {
            this.showAlert("Er moet altijd een reis actief zijn om in te loggen.", "error");
            this.renderReizen(); 
            return;
        }
        await window.dbApi.toggleReisActief(id, isActief);
        this.showAlert("Actieve reis gewijzigd! Inlogscherm is geüpdatet.", "success");
        this.renderReizen();
    }

    // --- BESTEMMINGEN LOGICA (MET UPLOAD) ---
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

            const bgHtml = h.bg_image.startsWith('http') 
                ? `<a href="${h.bg_image}" target="_blank" class="text-blue-500 hover:underline">Bekijk Foto</a>` 
                : `<span class="text-gray-400">${h.bg_image}</span>`;
            
            tr.innerHTML = `
                <td class="p-3 text-xs font-bold text-gray-500">${reisNaam}</td>
                <td class="p-3 font-bold">${h.naam}</td>
                <td class="p-3 text-xs">${bgHtml}</td>
                <td class="p-3 text-center">
                    <label class="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" ${checkedState} onchange="window.adminApp.toggleBestemming(${h.id}, this.checked)" class="sr-only peer">
                        <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500 shadow-sm"></div>
                    </label>
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

        // 1. Upload de foto eerst
        const uploadRes = await window.dbApi.uploadAfbeelding(file);
        if (!uploadRes.success) {
            return this.showAlert("Fout bij het uploaden van de foto: " + uploadRes.message, "error");
        }

        // 2. Sla het hotel op inclusief de nieuwe weblink naar de foto
        const res = await window.dbApi.addHotel(reis_id, naam, uploadRes.url); 
        
        if (res.success) {
            this.hotels = await window.dbApi.getHotels(false);
            this.populateHotelDropdown();
            
            this.showAlert("Bestemming/Hotel en dashboardfoto toegevoegd!", "success");
            const form = document.getElementById('addBestemmingForm');
            if(form) form.reset();
            this.renderBestemmingen();
        } else {
            this.showAlert("Er ging iets mis bij het toevoegen.", "error");
        }
    }

    async toggleBestemming(id, isActief) {
        await window.dbApi.toggleHotelActief(id, isActief);
        this.showAlert(isActief ? "Bestemming is nu zichtbaar!" : "Bestemming verborgen.", "info");
        
        this.hotels = await window.dbApi.getHotels(false);
        this.populateHotelDropdown();
    }

    // --- KAMERS LOGICA ---
    async renderKamers() {
        const tbody = document.getElementById('kamersTableBody');
        if (!tbody) return;
        const kamers = await window.dbApi.getAllKamersAdmin();
        tbody.innerHTML = '';

        kamers.forEach(k => {
            const hInfo = this.hotels.find(x => x.id === k.hotelid);
            const hotelNaam = hInfo ? hInfo.naam : 'Onbekend';

            const tr = document.createElement('tr');
            tr.className = 'border-b hover:bg-gray-50';
            tr.innerHTML = `
                <td class="p-3 text-gray-500">#${k.id}</td>
                <td class="p-3 font-medium">${k.kamer_nr}</td>
                <td class="p-3">${hotelNaam}</td>
                <td class="p-3">${k.geslacht === 'M' ? 'Jongens' : 'Meisjes'}</td>
                <td class="p-3">${k.capaciteit} (Bezet: ${k.bezet})</td>
                <td class="p-3">
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
        const kamers = await window.dbApi.getAllKamersAdmin();
        grid.innerHTML = '';

        const bezetteKamers = kamers.filter(k => k.bezet > 0);

        if (bezetteKamers.length === 0) {
            grid.innerHTML = `<div class="col-span-2 p-8 text-center text-gray-500 bg-gray-50 rounded border border-dashed">Er zijn nog geen reservaties gemaakt.</div>`;
            return;
        }

        bezetteKamers.forEach(k => {
            const hInfo = this.hotels.find(x => x.id === k.hotelid);
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
                <td class="p-3">
                    ${!hasRes ? `<button onclick="window.adminApp.deleteLeerling('${l.id}')" class="text-red-500 hover:underline font-medium">Verwijder</button>` : '<span class="text-gray-400 text-xs italic">Beveiligd (Bezet)</span>'}
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

    // --- CSV EXPORT LOGICA ---
    async exportKamersCSV() {
        const kamers = await window.dbApi.getAllKamersAdmin();
        if (!kamers || kamers.length === 0) {
            this.showAlert("Er zijn geen kamers om te exporteren.", "error");
            return;
        }

        let csvContent = "Kamer Nummer;Bestemming;Geslacht;Capaciteit;Bezet;Vrij;Namen Leerlingen\n";

        kamers.forEach(k => {
            const hInfo = this.hotels.find(x => x.id === k.hotelid);
            const hotelNaam = hInfo ? hInfo.naam : 'Onbekend';
            const geslacht = k.geslacht === 'M' ? 'Jongens' : 'Meisjes';
            const vrij = k.capaciteit - k.bezet;
            const namen = k.reservaties.map(r => r.gebruiker ? `${r.gebruiker.vnaam} ${r.gebruiker.naam}` : 'Onbekend').join(', ');
            const escapedNamen = `"${namen}"`;
            
            csvContent += `${k.kamer_nr};${hotelNaam};${geslacht};${k.capaciteit};${k.bezet};${vrij};${escapedNamen}\n`;
        });

        const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' }); 
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", "kamerverdeling_export.csv");
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        this.showAlert("CSV Export succesvol gedownload!", "success");
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

    logout() {
        window.dbApi.logout();
        window.location.href = 'login.html';
    }

    showAlert(msg, type) {
        const box = document.getElementById('alertBox');
        if(!box) return;
        box.innerText = msg;
        box.className = 'mb-6 p-4 rounded-xl border block transition-opacity font-medium shadow-sm';
        
        if (type === 'success') box.classList.add('bg-green-50', 'text-green-800', 'border-green-200');
        else if (type === 'error') box.classList.add('bg-red-50', 'text-red-800', 'border-red-200');
        else box.classList.add('bg-blue-50', 'text-blue-800', 'border-blue-200');

        setTimeout(() => {
            box.classList.add('hidden');
            box.className = 'hidden mb-6 p-4 rounded-xl border'; 
        }, 3000);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.adminApp = new AdminApp();
});
