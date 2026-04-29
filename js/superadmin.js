// js/superadmin.js - Logica voor het centrale SaaS Beheerpaneel

class SuperAdminApp {
    constructor() {
        this.client = window.dbApi.supabaseClient;
        this.isAuthenticated = sessionStorage.getItem('superadmin_auth') === 'true';
        this.scholen = [];
        this.init();
    }

    async init() {
        if (!this.isAuthenticated) {
            this.showLoginUI();
        } else {
            this.showDashboardUI();
            await this.loadScholen();
        }
        this.setupEventListeners();
    }

    setupEventListeners() {
        const loginForm = document.getElementById('superLoginForm');
        if (loginForm) {
            loginForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.login();
            });
        }

        const addSchoolForm = document.getElementById('addSchoolForm');
        if (addSchoolForm) {
            addSchoolForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.addSchool();
            });
        }
    }

    // --- AUTHENTICATIE ---
    async login() {
        const password = document.getElementById('sa_password').value;
        const { data, error } = await this.client.rpc('verify_superadmin_password', { p_password: password });

        if (data === true) {
            sessionStorage.setItem('superadmin_auth', 'true');
            this.isAuthenticated = true;
            this.showAlert("Succesvol ingelogd als Super-Admin.", "success");
            this.showDashboardUI();
            await this.loadScholen();
        } else {
            this.showAlert("Toegang geweigerd. Onjuist wachtwoord.", "error");
        }
    }

    logout() {
        sessionStorage.removeItem('superadmin_auth');
        this.isAuthenticated = false;
        this.showLoginUI();
    }

    // --- SCHOLEN BEHEREN ---
    async loadScholen() {
        const { data, error } = await this.client.from('school').select('*').order('created_at', { ascending: false });
        if (error) {
            this.showAlert("Fout bij het ophalen van scholen.", "error");
            return;
        }
        
        this.scholen = data || [];
        this.renderScholenTable();
    }

    renderScholenTable() {
        const tbody = document.getElementById('scholenTableBody');
        if (!tbody) return;
        tbody.innerHTML = '';

        let baseUrl = window.location.href.split('superadmin.html')[0];

        this.scholen.forEach(school => {
            const tr = document.createElement('tr');
            tr.className = 'border-b hover:bg-gray-50';
            
            const loginLink = `${baseUrl}login.html?school=${school.slug}`;

            tr.innerHTML = `
                <td class="p-3 font-medium text-gray-900">${school.naam}</td>
                <td class="p-3 text-gray-500 font-mono text-sm">${school.slug}</td>
                <td class="p-3 text-gray-500 text-sm">${new Date(school.created_at).toLocaleDateString('nl-BE')}</td>
                <td class="p-3">
                    <a href="${loginLink}" target="_blank" class="text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded border border-blue-200 hover:bg-blue-100 transition">Test Login</a>
                </td>
                <td class="p-3 text-right">
                    <button onclick="window.superAdmin.resetSchoolPassword(${school.id})" class="text-orange-500 hover:text-orange-700 font-medium text-sm mr-3">Reset Wachtwoord</button>
                    <button onclick="window.superAdmin.deleteSchool(${school.id}, '${school.naam}')" class="text-red-600 hover:text-red-800 font-medium text-sm">Verwijder</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    async addSchool() {
        const naam = document.getElementById('s_naam').value;
        const slug = document.getElementById('s_slug').value.toLowerCase().replace(/[^a-z0-9-]/g, '');
        const wachtwoord = document.getElementById('s_wachtwoord').value;

        if (wachtwoord.length < 6) {
            return this.showAlert("Wachtwoord moet minimaal 6 tekens bevatten.", "error");
        }

        const { data, error } = await this.client.rpc('create_school', { 
            p_naam: naam, 
            p_slug: slug, 
            p_wachtwoord: wachtwoord 
        });

        if (data === true) {
            this.showAlert(`School '${naam}' is succesvol aangemaakt!`, "success");
            document.getElementById('addSchoolForm').reset();
            await this.loadScholen();
        } else {
            this.showAlert("Fout bij aanmaken. Bestaat deze slug al?", "error");
        }
    }

    async deleteSchool(id, naam) {
        const confirmText = prompt(`GEVAARLIJK: Typ de naam van de school (${naam}) om deze en ALLE bijbehorende data (reizen, hotels, leerlingen, reservaties) permanent te verwijderen:`);
        
        if (confirmText === naam) {
            const { error } = await this.client.from('school').delete().eq('id', id);
            if (!error) {
                this.showAlert(`School ${naam} is permanent verwijderd.`, "success");
                await this.loadScholen();
            } else {
                this.showAlert("Fout bij het verwijderen van de school.", "error");
            }
        } else if (confirmText !== null) {
            this.showAlert("Naam komt niet overeen. Verwijderen geannuleerd.", "info");
        }
    }

    async resetSchoolPassword(id) {
        const nieuwWachtwoord = prompt("Voer een nieuw wachtwoord in voor de beheerder van deze school:");
        if (nieuwWachtwoord && nieuwWachtwoord.length >= 6) {
            
            // Gebruik bcrypt via een tijdelijke update query in SQL (vereist aanpassing backend als je dit direct wil via JS, of we gebruiken een rpc).
            // Voor nu sturen we dit via een algemene RPC:
            const { data, error } = await this.client.rpc('force_reset_teacher_password', { 
                p_school_id: id, 
                p_new_password: nieuwWachtwoord 
            });

            if (!error) {
                this.showAlert("Wachtwoord succesvol overschreven.", "success");
            } else {
                this.showAlert("Fout bij het resetten van het wachtwoord.", "error");
            }
        } else if (nieuwWachtwoord !== null) {
            this.showAlert("Wachtwoord te kort. Annulatie.", "error");
        }
    }

    // --- UI HELPERS ---
    showLoginUI() {
        document.getElementById('superLoginScreen').classList.remove('hidden');
        document.getElementById('superDashboardScreen').classList.add('hidden');
    }

    showDashboardUI() {
        document.getElementById('superLoginScreen').classList.add('hidden');
        document.getElementById('superDashboardScreen').classList.remove('hidden');
    }

    showAlert(msg, type) {
        const box = document.getElementById('alertBox');
        if (!box) return alert(msg);
        
        box.innerText = msg;
        box.className = 'fixed bottom-4 right-4 z-50 p-4 rounded-lg border shadow-lg font-medium text-sm transition-opacity';
        
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
    window.superAdmin = new SuperAdminApp();
});
