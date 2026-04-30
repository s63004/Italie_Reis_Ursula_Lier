// data.js - Supabase Database en Logica (SaaS Multi-Tenant, Genormaliseerd & Gelogd)

const supabaseUrl = window.appConfig.supabaseUrl;
const supabaseKey = window.appConfig.publishableKey;

const supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);

function getCurrentUser() {
    const user = localStorage.getItem('currentUser');
    return user ? JSON.parse(user) : null;
}

function logout() {
    const u = getCurrentUser();
    if (u) writeLog('LOGOUT', u.id, 'Gebruiker heeft uitgelogd');
    localStorage.removeItem('currentUser');
}

async function writeLog(actie, persoon_id, details) {
    if (!persoon_id) return;
    try {
        await supabaseClient.from('log').insert([{ actie, persoon_id, details }]);
    } catch (e) { console.error("Log error", e); }
}

let _serverTimeOffset = 0;

async function syncServerTime() {
    try {
        const clientBefore = Date.now();
        const { data, error } = await supabaseClient.rpc('get_server_time');
        const clientAfter = Date.now();

        if (data && data.server_ts) {
            const clientMid = Math.floor((clientBefore + clientAfter) / 2);
            _serverTimeOffset = data.server_ts - clientMid;
            console.log('🕐 Server time offset:', _serverTimeOffset, 'ms');
        }
    } catch (e) {
        console.error('Server time sync error:', e);
    }
}

function getEstimatedServerTime() {
    return Date.now() + _serverTimeOffset;
}

async function getAppSettings() {
    const { data, error } = await supabaseClient.from('app_settings').select('*');
    if (error) return {};
    return data.reduce((acc, item) => {
        acc[item.key] = item.value;
        return acc;
    }, {});
}

// --- MULTI-TENANT SCHOOL LOGICA ---
async function getSchoolBySlug(slug) {
    const { data, error } = await supabaseClient.from('school').select('*').eq('slug', slug).maybeSingle();
    if (error) {
        console.error("Fout bij ophalen school via slug", error);
        return null;
    }
    return data;
}

// --- FOTO UPLOAD LOGICA ---
async function uploadAfbeelding(file) {
    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
    
    const { data, error } = await supabaseClient.storage
        .from('afbeeldingen')
        .upload(fileName, file, { cacheControl: '3600', upsert: false });
        
    if (error) {
        console.error("Upload error:", error);
        return { success: false, message: error.message };
    }
    
    const { data: urlData } = supabaseClient.storage
        .from('afbeeldingen')
        .getPublicUrl(fileName);
        
    return { success: true, url: urlData.publicUrl };
}

// --- REIZEN LOGICA ---
async function getReizen(onlyActive = false) {
    const u = getCurrentUser();
    if (!u || !u.school_id) return [];

    let query = supabaseClient.from('reis').select('*').eq('school_id', u.school_id).order('id');
    if (onlyActive) query = query.eq('is_actief', true);
    
    const { data, error } = await query;
    if (error) console.error("Fout bij ophalen reizen", error);
    return data || [];
}

async function getReisBySlug(slug, schoolId) {
    const { data, error } = await supabaseClient.from('reis')
        .select('*')
        .eq('slug', slug)
        .eq('school_id', schoolId)
        .maybeSingle();
    if (error) console.error("Fout bij ophalen reis via slug", error);
    return data;
}

async function addReis(naam, slug, login_bg) {
    const u = getCurrentUser();
    if (!u) return { success: false, message: "Niet ingelogd." };

    const { error } = await supabaseClient.from('reis').insert([{ naam, slug, login_bg, is_actief: false, school_id: u.school_id }]);
    if (error) return { success: false, message: error.message };
    
    await writeLog('ADMIN_ADD_REIS', u.id, `Reis ${naam} toegevoegd`);
    return { success: true };
}

async function updateReis(id, naam, slug, login_bg, is_actief) {
    const updateData = { naam, slug };
    if (login_bg) updateData.login_bg = login_bg;
    if (is_actief !== undefined) updateData.is_actief = is_actief;
    
    const { error } = await supabaseClient.from('reis').update(updateData).eq('id', id);
    return { success: !error, message: error?.message };
}

async function deleteReis(id) {
    const { error } = await supabaseClient.from('reis').delete().eq('id', id);
    return { success: !error, message: error?.message };
}

async function toggleReisActief(id, is_actief) {
    const u = getCurrentUser();
    if (is_actief) {
        // Enkel andere reizen van DEZE school deactiveren
        await supabaseClient.from('reis').update({ is_actief: false }).eq('school_id', u.school_id).neq('id', 0);
    }
    await supabaseClient.from('reis').update({ is_actief }).eq('id', id);
    return { success: true };
}

// --- HOTELS LOGICA ---
async function getHotels(onlyActive = false, reisId = null) {
    const u = getCurrentUser();
    if (!u) return [];

    // Inner join met reis om veilig enkel de hotels van de eigen school op te halen
    let query = supabaseClient.from('hotel').select('*, reis!inner(*)').eq('reis.school_id', u.school_id).order('id');
    if (onlyActive) query = query.eq('is_actief', true);
    if (reisId) query = query.eq('reis_id', reisId);
    
    const { data, error } = await query;
    if (error) console.error("Fout bij ophalen hotels", error);
    return data || [];
}

async function addHotel(reis_id, naam, bg_image) {
    await supabaseClient.from('hotel').insert([{ reis_id: parseInt(reis_id), naam, bg_image, is_actief: false }]);
    const u = getCurrentUser();
    await writeLog('ADMIN_ADD_HOTEL', u.id, `Hotel ${naam} toegevoegd aan reis ${reis_id}`);
    return { success: true };
}

async function updateHotel(id, naam, bg_image, reis_id) {
    const updateData = { naam };
    if (bg_image) updateData.bg_image = bg_image;
    if (reis_id) updateData.reis_id = parseInt(reis_id);

    await supabaseClient.from('hotel').update(updateData).eq('id', id);
    const u = getCurrentUser();
    await writeLog('ADMIN_UPDATE_HOTEL', u.id, `Bestemming ${id} aangepast`);
    return { success: true };
}

async function deleteHotel(id) {
    const { error } = await supabaseClient.from('hotel').delete().eq('id', id);
    return { success: !error, message: error?.message };
}

async function toggleHotelActief(id, is_actief) {
    await supabaseClient.from('hotel').update({ is_actief }).eq('id', id);
    return { success: true };
}

async function initializeDB() {
    return true; 
}

// --- AUTHENTICATIE & LOGIN ---
async function login(naam, vnaam, geslacht, isLeerkracht = false, studentId = null, schoolId = null) {
    let internalId = null;
    let rol = isLeerkracht ? 'LEERKRACHT' : 'LEERLING';

    if (!schoolId) {
        console.error("Inloggen vereist nu een geldige school_id");
        return null;
    }

    if (isLeerkracht) {
        const { data: bestaand } = await supabaseClient.from('persoon')
            .select('id').eq('ss_id', studentId).eq('school_id', schoolId).maybeSingle();

        if (bestaand) {
            internalId = bestaand.id;
            await supabaseClient.from('persoon').update({ geslacht }).eq('id', internalId);
        } else {
            const { data: nieuw, error } = await supabaseClient.from('persoon')
                .insert([{ ss_id: studentId, naam, vnaam, geslacht, rol, school_id: schoolId }])
                .select('id').maybeSingle();
            if (nieuw) internalId = nieuw.id;
        }
    } else {
        // Leerling
        const { data: bestaand } = await supabaseClient.from('persoon')
            .select('id').eq('ss_id', studentId).eq('school_id', schoolId).maybeSingle();
            
        if(bestaand) {
            internalId = bestaand.id;
            await supabaseClient.from('persoon').update({ geslacht }).eq('id', internalId);
        } else {
            internalId = studentId;
            await supabaseClient.from('persoon').update({ geslacht }).eq('id', internalId).eq('school_id', schoolId);
        }
    }

    if (!internalId) return null;

    const { data: schoolData } = await supabaseClient.from('school').select('slug').eq('id', schoolId).maybeSingle();

    const sessionData = { 
        id: internalId, 
        ss_id: studentId, 
        naam: naam, 
        vnaam: vnaam, 
        geslacht: geslacht, 
        isLeerkracht: isLeerkracht,
        school_id: schoolId,
        school_slug: schoolData ? schoolData.slug : 'school'
    };
    
    localStorage.setItem('currentUser', JSON.stringify(sessionData));
    await writeLog('LOGIN', internalId, `Ingelogd als ${rol}`);

    return sessionData;
}

async function searchStudentForLogin(query, schoolId) {
    if (!query || query.length < 2 || !schoolId) return [];
    const { data, error } = await supabaseClient.from('persoon')
        .select('*')
        .eq('rol', 'LEERLING')
        .eq('school_id', schoolId)
        .or(`naam.ilike.%${query}%,vnaam.ilike.%${query}%`)
        .limit(8);
    return data || [];
}

async function checkTimeouts() {
    try {
        const { data, error } = await supabaseClient.rpc('cleanup_expired_pending');
        if (data && data.deleted > 0) {
            console.log(`🧹 ${data.deleted} verlopen pending reservering(en) opgeruimd`);
            return true;
        }
    } catch (e) {
        console.error('Cleanup error:', e);
    }
    return false;
}

async function getKamersMetStatus(hotel_id, geslacht) {
    await checkTimeouts();

    const { data: kamers } = await supabaseClient.from('kamer').select('*').eq('hotel_id', hotel_id).eq('geslacht', geslacht).order('id');
    if (!kamers) return [];

    const { data: reserveringen } = await supabaseClient.from('reservering').select(`id, status, timestamp, kamer_id, persoon:persoon_id (id, vnaam, naam, geslacht)`);
    const serverNow = getEstimatedServerTime();

    return kamers.map(k => {
        const kamerRes = (reserveringen || []).filter(r => r.kamer_id === k.id).map(r => ({
            id: r.id,
            kamerid: r.kamer_id,
            gebruikerid: r.persoon.id,
            status: r.status,
            timestamp: r.timestamp,
            gebruiker: { id: r.persoon.id, vnaam: r.persoon.vnaam, naam: r.persoon.naam }
        }));

        const confirmedCount = kamerRes.filter(r => r.status === 'confirmed').length;
        const activePending = kamerRes.filter(r => r.status === 'pending' && r.timestamp > (serverNow - 60000));
        const isLocked = activePending.length > 0;

        return {
            id: k.id,
            kamer_nr: k.kamer_nr,
            hotelid: k.hotel_id,
            geslacht: k.geslacht,
            capaciteit: k.capaciteit,
            bezet: confirmedCount + activePending.length,
            vrij: k.capaciteit - confirmedCount - activePending.length,
            reservaties: kamerRes,
            isLocked: isLocked,
            lockedByPending: activePending
        };
    });
}

async function reserveerPlek(kamerId, persoon_id) {
    const numericPersoonId = parseInt(persoon_id);
    if (isNaN(numericPersoonId)) return { success: false, message: 'Sessiefout. Log opnieuw in.' };

    const { data: kamer } = await supabaseClient.from('kamer').select('hotel_id').eq('id', kamerId).maybeSingle();
    if (!kamer) return { success: false, message: 'Kamer niet gevonden.' };

    const { data, error } = await supabaseClient.rpc('claim_kamer', { p_kamer_id: parseInt(kamerId), p_persoon_id: numericPersoonId, p_hotel_id: parseInt(kamer.hotel_id) });

    if (error) return { success: false, message: 'Er ging iets mis bij het reserveren.' };
    if (data && data.success) {
        await writeLog('RESERVEER_PENDING', numericPersoonId, `Kamer ${kamerId} geselecteerd`);
        return { success: true, server_ts: data.server_ts };
    }
    return { success: false, message: data?.message || 'Onbekende fout.' };
}

async function searchStudent(query, geslacht, hotelId) {
    if (!query || query.length < 2) return [];
    
    const u = getCurrentUser();
    if (!u) return [];

    const { data: personen } = await supabaseClient.from('persoon')
        .select('*')
        .eq('school_id', u.school_id)
        .eq('rol', 'LEERLING')
        .eq('geslacht', geslacht)
        .or(`naam.ilike.%${query}%,vnaam.ilike.%${query}%`);
        
    if (!personen) return [];

    const { data: hotelKamers } = await supabaseClient.from('kamer').select('id').eq('hotel_id', hotelId);
    const hotelKamerIds = hotelKamers.map(k => k.id);
    const { data: activeReserveringen } = await supabaseClient.from('reservering').select('persoon_id').in('kamer_id', hotelKamerIds);
    const takenIds = activeReserveringen.map(r => r.persoon_id);

    return personen.filter(p => !takenIds.includes(p.id)).slice(0, 5);
}

async function bevestigReservatie(persoon_id, roommateIds = []) {
    const numericPersoonId = parseInt(persoon_id);
    if (isNaN(numericPersoonId)) return { success: false, message: 'Sessiefout gedetecteerd. Log opnieuw in.' };

    const safeRoommateIds = roommateIds.length > 0 ? roommateIds.map(id => parseInt(id)).filter(id => !isNaN(id)) : null;
    const { data, error } = await supabaseClient.rpc('bevestig_kamer', { p_persoon_id: numericPersoonId, p_roommate_ids: safeRoommateIds });

    if (error) return { success: false, message: 'Er ging iets mis bij het bevestigen.' };
    if (data && data.success) {
        await writeLog('RESERVEER_BEVESTIGD', numericPersoonId, `Kamer bevestigd met ${safeRoommateIds ? safeRoommateIds.length : 0} roommates`);
        return { success: true, message: data.message };
    }
    return { success: false, message: data?.message || 'Onbekende fout.' };
}

async function annuleerPending(persoon_id) {
    const numericPersoonId = parseInt(persoon_id);
    if (isNaN(numericPersoonId)) return;
    const { data } = await supabaseClient.from('reservering').delete().eq('persoon_id', numericPersoonId).eq('status', 'pending').select();
    if (data && data.length > 0) await writeLog('ANNULEER', numericPersoonId, `Pending reservering geannuleerd`);
}

// --- ADMIN & WACHTWOORD LOGICA ---
// AANGEPAST: schoolId toegevoegd als parameter zodat we dit tijdens de login kunnen verifiëren zonder actieve sessie
async function verifyTeacherPassword(password, schoolId = null) {
    const u = getCurrentUser();
    const sid = schoolId || (u ? u.school_id : null);
    
    if (!sid) return false;
    try {
        const { data, error } = await supabaseClient.rpc('verify_teacher_password', { p_password: password, p_school_id: sid });
        if (error) return false;
        return data === true;
    } catch (e) { return false; }
}

async function updateTeacherPassword(oldPassword, newPassword) {
    const u = getCurrentUser();
    if (!u) return false;
    try {
        const { data, error } = await supabaseClient.rpc('update_teacher_password', { p_old_password: oldPassword, p_new_password: newPassword, p_school_id: u.school_id });
        if (error) return false;
        return data === true;
    } catch (e) { return false; }
}

// --- KAMERS LOGICA ---
async function getAllKamersAdmin(hotelId = null) {
    const u = getCurrentUser();
    if(!u) return [];

    const hotels = await getHotels();
    const allowedHotelIds = hotels.map(h => h.id);

    let baseQuery = supabaseClient.from('kamer').select('*').in('hotel_id', allowedHotelIds).order('id');
    if (hotelId) baseQuery = baseQuery.eq('hotel_id', hotelId); 
    
    const { data: kamers } = await baseQuery;
    const { data: reserveringen } = await supabaseClient.from('reservering').select('*, persoon:persoon_id(*)');

    if (!kamers) return [];

    return kamers.map(k => {
        const kamerRes = (reserveringen || []).filter(r => r.kamer_id === k.id);
        const hInfo = hotels.find(h => h.id === k.hotel_id);
        
        return {
            id: k.id, kamer_nr: k.kamer_nr, hotelid: k.hotel_id, geslacht: k.geslacht, capaciteit: k.capaciteit,
            bezet: kamerRes.length, hotel: hInfo,
            reservaties: kamerRes.map(r => ({ id: r.id, kamerid: r.kamer_id, gebruikerid: r.persoon.id, status: r.status, gebruiker: r.persoon }))
        };
    });
}

async function addMeerdereKamers(kamersArray) {
    await supabaseClient.from('kamer').insert(kamersArray);
    const u = getCurrentUser();
    await writeLog('ADMIN_ADD_KAMERS_BULK', u.id, `${kamersArray.length} kamers tegelijk toegevoegd`);
    return { success: true };
}

async function addKamer(hotel_id, kamer_nr, geslacht, capaciteit) {
    await supabaseClient.from('kamer').insert([{ hotel_id: parseInt(hotel_id), kamer_nr, geslacht, capaciteit: parseInt(capaciteit) }]);
    const u = getCurrentUser();
    await writeLog('ADMIN_ADD_KAMER', u.id, `Kamer ${kamer_nr} toegevoegd`);
    return { success: true };
}

async function updateKamer(kamer_id, kamer_nr, capaciteit, geslacht) {
    await supabaseClient.from('kamer').update({ kamer_nr, capaciteit: parseInt(capaciteit), geslacht }).eq('id', kamer_id);
    const u = getCurrentUser();
    await writeLog('ADMIN_EDIT_KAMER', u.id, `Kamer ${kamer_id} bewerkt`);
    return { success: true };
}

async function deleteKamer(kamer_id) {
    const { count } = await supabaseClient.from('reservering').select('*', { count: 'exact', head: true }).eq('kamer_id', kamer_id);
    if (count > 0) return { success: false, message: "Kan kamer niet verwijderen: er zitten nog studenten in." };
    await supabaseClient.from('kamer').delete().eq('id', kamer_id);
    const u = getCurrentUser();
    await writeLog('ADMIN_DELETE_KAMER', u.id, `Kamer ${kamer_id} verwijderd`);
    return { success: true };
}

async function removeReservatieAdmin(res_id) {
    const { data } = await supabaseClient.from('reservering').select('*, kamer(*), persoon(*)').eq('id', res_id).maybeSingle();
    await supabaseClient.from('reservering').delete().eq('id', res_id);
    const u = getCurrentUser();
    if (data) await writeLog('ADMIN_KICK_USER', u.id, `${data.persoon.naam} gekickt uit kamer ${data.kamer.kamer_nr}`);
    return { success: true };
}

async function kickAllInKamer(kamer_id) {
    await supabaseClient.from('reservering').delete().eq('kamer_id', kamer_id);
    const u = getCurrentUser();
    await writeLog('ADMIN_KICK_KAMER', u.id, `Hele kamer ${kamer_id} is leeggemaakt.`);
    return { success: true };
}

// --- LEERLINGEN LOGICA ---
async function getAllLeerlingen() {
    const u = getCurrentUser();
    if (!u) return [];

    const { data } = await supabaseClient.from('persoon').select('*').eq('school_id', u.school_id).order('naam');
    return data || [];
}

async function addLeerling(vnaam, naam, geslacht) {
    const u = getCurrentUser();
    await supabaseClient.from('persoon').insert([{ vnaam, naam, geslacht, klas: '-', rol: 'LEERLING', school_id: u.school_id }]);
    await writeLog('ADMIN_ADD_PERSOON', u.id, `${vnaam} ${naam} toegevoegd`);
    return { success: true };
}

async function updateLeerling(id, vnaam, naam, geslacht, klas) {
    await supabaseClient.from('persoon').update({ vnaam, naam, geslacht, klas }).eq('id', id);
    const u = getCurrentUser();
    await writeLog('ADMIN_UPDATE_PERSOON', u.id, `Gegevens van ${vnaam} ${naam} bijgewerkt`);
    return { success: true };
}

async function deleteLeerling(id) {
    const numericId = parseInt(id);
    const { count } = await supabaseClient.from('reservering').select('*', { count: 'exact', head: true }).eq('persoon_id', numericId);
    if (count > 0) return { success: false, message: "Deze leerling heeft al een kamer. Verwijder eerst de reservatie." };
    await supabaseClient.from('persoon').delete().eq('id', numericId);
    const u = getCurrentUser();
    await writeLog('ADMIN_DELETE_PERSOON', u.id, `Persoon ${numericId} verwijderd`);
    return { success: true };
}

async function importCSVLeerlingen(csvText) {
    try {
        const u = getCurrentUser();
        const lines = csvText.split('\n');
        if (lines.length < 1) return { success: false, message: "Bestand lijkt leeg." };

        let newPersonen = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            const parts = line.split(/[;,]/).map(p => p.trim());
            if (parts.length >= 5) {
                if (i === 0 && (parts[0].toLowerCase() === 'klas' || parts[1].toLowerCase() === 'naam')) continue;
                newPersonen.push({ 
                    klas: parts[0], 
                    naam: parts[1], 
                    vnaam: parts[2], 
                    rol: parts[3].toUpperCase(), 
                    geslacht: parts[4] ? parts[4].toUpperCase() : null,
                    school_id: u.school_id 
                });
            }
        }
        if (newPersonen.length === 0) return { success: false, message: "Geen geldige data gevonden." };
        await supabaseClient.from('persoon').upsert(newPersonen, { onConflict: 'id' });
        
        await writeLog('ADMIN_IMPORT_CSV', u.id, `${newPersonen.length} personen geïmporteerd`);
        return { success: true, count: newPersonen.length };
    } catch (e) { return { success: false, message: "Er ging iets mis tijdens het verwerken van de CSV." }; }
}

// EXPORTS
window.dbApi = {
    login, logout, getCurrentUser, initializeDB, getKamersMetStatus, reserveerPlek,
    bevestigReservatie, checkTimeouts, annuleerPending, searchStudent, searchStudentForLogin,
    syncServerTime, getEstimatedServerTime, verifyTeacherPassword, updateTeacherPassword,
    getAllKamersAdmin, addKamer, addMeerdereKamers, updateKamer, deleteKamer, removeReservatieAdmin,
    kickAllInKamer, getAllLeerlingen, addLeerling, updateLeerling, deleteLeerling, importCSVLeerlingen, 
    uploadAfbeelding, getAppSettings, getSchoolBySlug, getReizen, getReisBySlug, addReis, updateReis, 
    deleteReis, toggleReisActief, getHotels, addHotel, updateHotel, deleteHotel, toggleHotelActief, supabaseClient
};
