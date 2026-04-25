// admin.js - Logica voor het Admin Paneel

class AdminApp {
    constructor() {
        this.user = window.dbApi.getCurrentUser();
        if (!this.user || !this.user.isLeerkracht) {
            alert("Toegang geweigerd. Alleen voor leerkrachten.");
            window.location.href = 'login.html';
            return;
        }

        this.currentTab = 'kamers';
        this.init();
    }

    init() {
        document.getElementById('userInfo').innerText = `Admin: ${this.user.vnaam} ${this.user.naam}`;
        this.setTab('kamers');

        // Event listeners
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

        // Supabase Realtime: Live updates voor het admin paneel
        const client = window.dbApi.supabaseClient;

        client.channel('admin_realtime')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'reservering' }, () => {
                console.log('⚡ [LIVE] Reservering gewijzigd');
                this.refreshCurrentTab();
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'persoon' }, () => {
                console.log('⚡ [LIVE] Persoon gewijzigd');
                this.refreshCurrentTab();
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'kamer' }, () => {
                console.log('⚡ [LIVE] Kamer gewijzigd');
                this.refreshCurrentTab();
            })
            .subscribe((status) => {
                console.log('🔌 Admin Realtime status:', status);
            });

        // Fallback: ververs automatisch elke 3 seconden (voor als Realtime niet werkt)
        setInterval(() => {
            this.refreshCurrentTab();
        }, 3000);
    }

    // Ververs de data van de tab die nu open staat (zonder tab te wisselen)
    refreshCurrentTab() {
        if (this.currentTab === 'kamers') this.renderKamers();
        if (this.currentTab === 'reservaties') this.renderReservaties();
        if (this.currentTab === 'leerlingen') this.renderLeerlingen();
        // instellingen hoeft niet te refreshen
    }

    setTab(tab) {
        this.currentTab = tab;
        
        // Hide all
        ['kamers', 'reservaties', 'leerlingen', 'instellingen'].forEach(t => {
            document.getElementById(`content-${t}`).classList.add('hidden');
            
            const navBtn = document.getElementById(`nav-${t}`);
            navBtn.classList.remove('text-orange-600', 'bg-orange-50', 'border-l-4', 'border-orange-500');
            navBtn.classList.add('text-gray-600');
        });

        // Show active
        document.getElementById(`content-${tab}`).classList.remove('hidden');
        
        const activeNav = document.getElementById(`nav-${tab}`);
        activeNav.classList.remove('text-gray-600');
        activeNav.classList.add('text-orange-600', 'bg-orange-50', 'border-l-4', 'border-orange-500');

        // Render content
        if (tab === 'kamers') this.renderKamers();
        if (tab === 'reservaties') this.renderReservaties();
        if (tab === 'leerlingen') this.renderLeerlingen();
    }

    // --- KAMERS MODULE ---
    async renderKamers() {
        const tbody = document.getElementById('kamersTableBody');
        const kamers = await window.dbApi.getAllKamersAdmin();
        tbody.innerHTML = '';

        kamers.forEach(k => {
            const tr = document.createElement('tr');
            tr.className = 'border-b hover:bg-gray-50';
            tr.innerHTML = `
                <td class="p-3 text-gray-500">#${k.id}</td>
                <td class="p-3 font-medium">${k.kamer_nr}</td>
                <td class="p-3">${k.hotelid === 1 ? 'Como' : 'Montecatini'}</td>
                <td class="p-3">${k.geslacht === 'M' ? 'Jongens' : 'Meisjes'}</td>
                <td class="p-3">${k.capaciteit} (Bezet: ${k.bezet})</td>
                <td class="p-3">
                    <button onclick="window.adminApp.openEditKamer(${k.id}, '${k.kamer_nr}', ${k.capaciteit}, '${k.geslacht}')" class="text-blue-500 hover:underline mr-3">Bewerk</button>
                    ${k.bezet === 0 ? `<button onclick="window.adminApp.deleteKamer(${k.id})" class="text-red-500 hover:underline">Verwijder</button>` : '<span class="text-gray-400 text-xs">Bezet</span>'}
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    async addKamer() {
        const hotel = document.getElementById('k_hotel').value;
        const nr = document.getElementById('k_nr').value;
        const geslacht = document.getElementById('k_geslacht').value;
        const cap = document.getElementById('k_cap').value;

        await window.dbApi.addKamer(hotel, nr, geslacht, cap);
        this.showAlert("Kamer toegevoegd!", "success");
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

    // --- RESERVATIES MODULE ---
    async renderReservaties() {
        const grid = document.getElementById('resGrid');
        const kamers = await window.dbApi.getAllKamersAdmin();
        grid.innerHTML = '';

        const bezetteKamers = kamers.filter(k => k.bezet > 0);

        if (bezetteKamers.length === 0) {
            grid.innerHTML = `<div class="col-span-2 p-8 text-center text-gray-500 bg-gray-50 rounded border border-dashed">Er zijn nog geen reservaties gemaakt.</div>`;
            return;
        }

        bezetteKamers.forEach(k => {
            const card = document.createElement('div');
            card.className = 'border border-gray-200 rounded-lg p-4 bg-white shadow-sm';
            
            let html = `
                <div class="flex justify-between items-center mb-4 border-b pb-2">
                    <h4 class="font-bold">Kamer ${k.kamer_nr} <span class="text-xs font-normal text-gray-500 ml-2">(${k.hotelid === 1 ? 'Como' : 'Montecatini'} - ${k.geslacht})</span></h4>
                    <span class="text-xs font-semibold px-2 py-1 bg-gray-100 rounded">${k.bezet}/${k.capaciteit}</span>
                </div>
                <ul class="space-y-2">
            `;

            k.reservaties.forEach(r => {
                const user = r.gebruiker;
                const statusColor = r.status === 'confirmed' ? 'text-green-600' : 'text-orange-500';
                
                html += `
                    <li class="flex justify-between items-center text-sm p-2 bg-gray-50 rounded border border-gray-100">
                        <div>
                            <span class="font-medium">${user ? user.vnaam + ' ' + user.naam : 'Onbekend'}</span>
                            <span class="text-xs ${statusColor} ml-2">(${r.status})</span>
                        </div>
                        <button onclick="window.adminApp.kickUser('${r.id}')" class="text-xs bg-red-100 text-red-600 hover:bg-red-200 px-2 py-1 rounded transition">Verwijder</button>
                    </li>
                `;
            });

            html += `</ul>`;
            card.innerHTML = html;
            grid.appendChild(card);
        });
    }

    async kickUser(resId) {
        if(confirm("Weet je zeker dat je deze reservatie wilt verwijderen? De leerling verliest zijn plaats.")) {
            await window.dbApi.removeReservatieAdmin(resId);
            this.showAlert("Reservatie verwijderd. De plaats is nu vrij.", "info");
            this.renderReservaties();
        }
    }

    // --- LEERLINGEN MODULE ---
    async renderLeerlingen() {
        const tbody = document.getElementById('leerlingenTableBody');
        const leerlingen = await window.dbApi.getAllLeerlingen();
        
        // Let op: In supabase moeten we misschien via join de reserveringen ophalen
        // Voor het admin paneel halen we even alle reserveringen apart op
        const { data: alleReservaties } = await window.dbApi.supabaseClient.from('reservering').select('*');
        
        tbody.innerHTML = '';

        // Sorteer op naam
        leerlingen.sort((a, b) => a.naam.localeCompare(b.naam));

        leerlingen.forEach(l => {
            const userRes = (alleReservaties || []).filter(r => r.persoon_id === l.id && r.status === 'confirmed');
            let statusHtml;
            if (userRes.length >= 2) {
                statusHtml = `<span class="px-2 py-1 bg-green-100 text-green-700 text-xs rounded font-medium">Beide hotels</span>`;
            } else if (userRes.length === 1) {
                statusHtml = `<span class="px-2 py-1 bg-yellow-100 text-yellow-700 text-xs rounded font-medium">1 hotel</span>`;
            } else {
                statusHtml = `<span class="px-2 py-1 bg-gray-100 text-gray-500 text-xs rounded font-medium">Nog niet</span>`;
            }
            const hasRes = userRes.length > 0;

            const geslachtTxt = l.geslacht ? (l.geslacht === 'M' ? 'Jongen' : 'Meisje') : '<span class="text-gray-400 italic text-xs">Onbekend (via login)</span>';
            const klasTxt = l.klas || '-';
            const rolTxt = l.rol === 'LK' ? '<span class="text-purple-600 font-semibold text-xs bg-purple-50 px-2 py-1 rounded">Leerkracht</span>' : '<span class="text-blue-600 font-medium text-xs">Leerling</span>';

            const tr = document.createElement('tr');
            tr.className = 'border-b hover:bg-gray-50';
            tr.innerHTML = `
                <td class="p-3 font-medium">${l.naam} ${l.vnaam}</td>
                <td class="p-3 text-gray-600">${klasTxt}</td>
                <td class="p-3">${rolTxt}</td>
                <td class="p-3">${geslachtTxt}</td>
                <td class="p-3">${statusHtml}</td>
                <td class="p-3">
                    ${!hasRes ? `<button onclick="window.adminApp.deleteLeerling('${l.id}')" class="text-red-500 hover:underline">Verwijder</button>` : '<span class="text-gray-400 text-xs">Kan niet verwijderen</span>'}
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
                fileInput.value = ''; // reset
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
        if(confirm("Leerling verwijderen uit de database?")) {
            const res = await window.dbApi.deleteLeerling(id);
            if(res.success) {
                this.showAlert("Leerling verwijderd.", "info");
                this.renderLeerlingen();
            } else {
                this.showAlert(res.message, "error");
            }
        }
    }

    // --- INSTELLINGEN MODULE ---
    async changePassword() {
        const oldPw = document.getElementById('pw_old').value;
        const newPw = document.getElementById('pw_new').value;
        const confirmPw = document.getElementById('pw_confirm').value;

        if (newPw !== confirmPw) {
            this.showAlert('Nieuwe wachtwoorden komen niet overeen.', 'error');
            return;
        }

        if (newPw.length < 6) {
            this.showAlert('Het nieuwe wachtwoord moet minstens 6 tekens lang zijn.', 'error');
            return;
        }

        const success = await window.dbApi.updateTeacherPassword(oldPw, newPw);

        if (success) {
            this.showAlert('Leerkracht-wachtwoord succesvol gewijzigd!', 'success');
            document.getElementById('changePasswordForm').reset();
        } else {
            this.showAlert('Het huidige wachtwoord is onjuist.', 'error');
        }
    }

    logout() {
        window.dbApi.logout();
        window.location.href = 'login.html';
    }

    showAlert(msg, type) {
        const box = document.getElementById('alertBox');
        box.innerText = msg;
        box.className = 'mb-6 p-4 rounded-xl border block transition-opacity font-medium shadow-sm';
        
        if (type === 'success') box.classList.add('bg-green-50', 'text-green-800', 'border-green-200');
        else if (type === 'error') box.classList.add('bg-red-50', 'text-red-800', 'border-red-200');
        else box.classList.add('bg-blue-50', 'text-blue-800', 'border-blue-200');

        setTimeout(() => {
            box.classList.add('hidden');
            box.className = 'hidden mb-6 p-4 rounded-xl border'; // reset
        }, 3000);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.adminApp = new AdminApp();
});
