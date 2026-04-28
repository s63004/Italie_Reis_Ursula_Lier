// data.js - Supabase Database en Logica (Genormaliseerd & Gelogd)

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

// --- NIEUW: FOTO UPLOAD LOGICA ---
async function uploadAfbeelding(file) {
    // Maak een unieke naam zodat foto's met dezelfde naam elkaar niet overschrijven
    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
    
    // Stuur de foto naar de 'afbeeldingen' bucket in Supabase Storage
    const { data, error } = await supabaseClient.storage
        .from('afbeeldingen')
        .upload(fileName, file, { cacheControl: '3600', upsert: false });
        
    if (error) {
        console.error("Upload error:", error);
        return { success: false, message: error.message };
    }
    
    // Haal de openbare URL op
    const { data: urlData } = supabaseClient.storage
        .from('afbeeldingen')
        .getPublicUrl(fileName);
        
    return { success: true, url: urlData.publicUrl };
}

// --- REIZEN LOGICA ---
async function getReizen(onlyActive = false) {
    let query = supabaseClient.from('reis').select('*').order('id');
    if (onlyActive) query = query.eq('is_actief', true);
    
    const { data, error } = await query;
    if (error) console.error("Fout bij ophalen reizen", error);
    return data || [];
}

async function addReis(naam, login_bg) {
    await supabaseClient.from('reis').insert([{ naam, login_bg, is_actief: false }]);
    const u = getCurrentUser();
    await writeLog('ADMIN_ADD_REIS', u.id, `Reis ${naam} toegevoegd`);
    return { success: true };
}

async function toggleReisActief(id, is_actief) {
    if (is_actief) {
        await supabaseClient.from('reis').update({ is_actief: false }).neq('id', 0);
    }
    await supabaseClient.from('reis').update({ is_actief }).eq('id', id);
    return { success: true };
}

// --- HOTELS LOGICA ---
async function getHotels(onlyActive = false, reisId = null) {
    let query = supabaseClient.from('hotel').select('*, reis:reis_id(*)').order('id');
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

async function updateHotel(id, naam, bg_image) {
    await supabaseClient.from('hotel').update({ naam, bg_image }).eq('id', id);
    const u = getCurrentUser();
    await writeLog('ADMIN_UPDATE_HOTEL', u.id, `Bestemming ${id} aangepast`);
    return { success: true };
}

async function toggleHotelActief(id, is_actief) {
    await supabaseClient.from('hotel').update({ is_actief }).eq('id', id);
    return { success: true };
}

async function initializeDB() {
    const { count } = await supabaseClient.from('kamer').select('*', { count: 'exact', head: true });
    if (count > 0) return; 

    let kamersToInsert = [];
    let initCounters = { 1: { 'M': 1, 'V': 1 }, 2: { 'M': 1, 'V': 1 } };

    function genereerKamers(hotel_id, geslacht, aantal, capaciteit) {
        for (let i = 0; i < aantal; i++) {
            let nr = initCounters[hotel_id][geslacht]++;
            kamersToInsert.push({
                kamer_nr: `${nr} (${geslacht === 'M' ? 'Jongens' : 'Meisjes'})`,
                geslacht: geslacht,
                hotel_id: hotel_id,
                capaciteit: capaciteit
            });
        }
    }

    genereerKamers(1, 'M', 20, 3);
    genereerKamers(1, 'M', 1, 2);
    genereerKamers(1, 'V', 13, 3);
    genereerKamers(1, 'V', 6, 2);

    genereerKamers(2, 'M', 14, 4);
    genereerKamers(2, 'M', 2, 3);
    genereerKamers(2, 'V', 12, 4);
    genereerKamers(2, 'V', 1, 3);

    await supabaseClient.from('kamer').insert(kamersToInsert);

    let personenToInsert = [];
    const jongensNamen = ['Lukas', 'Noah', 'Liam', 'Arthur', 'Mathis', 'Victor', 'Jules', 'Finn', 'Leon', 'Oscar'];
    const meisjesNamen = ['Olivia', 'Mila', 'Marie', 'Ella', 'Anna', 'Emma', 'Louise', 'Elena', 'Juliette', 'Lucie'];
    const achternamen = ['Peeters', 'Janssens', 'Maes', 'Jacobs', 'Mertens', 'Willems', 'Claes', 'Goossens'];

    for (let i = 0; i < 30; i++) {
        personenToInsert.push({ vnaam: jongensNamen[Math.floor(Math.random() * jongensNamen.length)], naam: achternamen[Math.floor(Math.random() * achternamen.length)], geslacht: 'M', klas: '6A', rol: 'LEERLING' });
        personenToInsert.push({ vnaam: meisjesNamen[Math.floor(Math.random() * meisjesNamen.length)], naam: achternamen[Math.floor(Math.random() * achternamen.length)], geslacht: 'V', klas: '6B', rol: 'LEERLING' });
    }
    await supabaseClient.from('persoon').insert(personenToInsert);
}

async function login(naam, vnaam, geslacht, isLeerkracht = false, studentId = null) {
    let internalId = null;
    let rol = isLeerkracht ? 'LEERKRACHT' : 'LEERLING';

    if (isLeerkracht) {
        const { data: bestaand } = await supabaseClient.from('persoon').select('id').eq('ss_id', studentId).single();

        if (bestaand) {
            internalId = bestaand.id;
            await supabaseClient.from('persoon').update({ geslacht }).eq('id', internalId);
        } else {
            const { data: nieuw, error } = await supabaseClient.from('persoon').insert([{ ss_id: studentId, naam, vnaam, geslacht, rol }]).select('id').single();
            if (nieuw) internalId = nieuw.id;
        }
    } else {
        internalId = studentId;
        await supabaseClient.from('persoon').update({ geslacht, ss_id: studentId }).eq('id', internalId);
    }

    if (!internalId) return null;

    const sessionData = { id: internalId, ss_id: studentId, naam: naam, vnaam: vnaam, geslacht: geslacht, isLeerkracht: isLeerkracht };
    localStorage.setItem('currentUser', JSON.stringify(sessionData));
    await writeLog('LOGIN', internalId, `Ingelogd als ${rol}`);

    return sessionData;
}

async function searchStudentForLogin(query) {
    if (!query || query.length < 2) return [];
    const { data, error } = await supabaseClient.from('persoon').select('*').eq('rol', 'LEERLING').or(`naam.ilike.%${query}%,vnaam.ilike.%${query}%`).limit(8);
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
    if (isNaN(numericPersoonId)) return { success: false, message: 'Oude accountgegevens (Ghost Data) gedetecteerd. Log opnieuw in.' };

    const { data: kamer } = await supabaseClient.from('kamer').select('hotel_id').eq('id', kamerId).single();
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

    const { data: personen } = await supabaseClient.from('persoon').select('*').eq('rol', 'LEERLING').eq('geslacht', geslacht).or(`naam.ilike.%${query}%,vnaam.ilike.%${query}%`);
    if (!personen) return [];

    const { data: hotelKamers } = await supabaseClient.from('kamer').select('id').eq('hotel_id', hotelId);
    const hotelKamerIds = hotelKamers.map(k => k.id);
    const { data: activeReserveringen } = await supabaseClient.from('reservering').select('persoon_id').in('kamer_id', hotelKamerIds);
    const takenIds = activeReserveringen.map(r => r.persoon_id);

    return personen.filter(p => !takenIds.includes(p.id)).slice(0, 5);
}

async function bevestigReservatie(persoon_id, roommateIds = []) {
    const numericPersoonId = parseInt(persoon_id);
    if (isNaN(numericPersoonId)) return { success: false, message: 'Oude accountgegevens (Ghost Data) gedetecteerd. Log opnieuw in.' };

    const safeRoommateIds = roommateIds.length > 0 ? roommateIds.map(id => parseInt(id)).filter(id => !isNaN(id)) : null;
    const { data, error } = await supabaseClient.rpc('bevestig_kamer', { p_persoon_id: numericPersoonId, p_roommate_ids: safeRoommateIds });

    if (error) return { success: false, message: 'Er ging iets mis bij het bevestigen.' };
    if (data && data.success) {
        await writeLog('RESERVEER_BEVESTIGD', numericPersoonId, `Kamer bevestigd met ${safeRoommateIds ? safeRoommateIds.length : 0} roommates`);
        return { success: true };
    }
    return { success: false, message: data?.message || 'Onbekende fout.' };
}

async function annuleerPending(persoon_id) {
    const numericPersoonId = parseInt(persoon_id);
    if (isNaN(numericPersoonId)) return;
    const { data } = await supabaseClient.from('reservering').delete().eq('persoon_id', numericPersoonId).eq('status', 'pending').select();
    if (data && data.length > 0) await writeLog('ANNULEER', numericPersoonId, `Pending reservering geannuleerd`);
}

async function verifyTeacherPassword(password) {
    try {
        const { data, error } = await supabaseClient.rpc('verify_teacher_password', { p_password: password });
        if (error) return false;
        return data === true;
    } catch (e) { return false; }
}

async function updateTeacherPassword(oldPassword, newPassword) {
    try {
        const { data, error } = await supabaseClient.rpc('update_teacher_password', { p_old_password: oldPassword, p_new_password: newPassword });
        if (error) return false;
        return data === true;
    } catch (e) { return false; }
}

async function getAllKamersAdmin() {
    const { data: kamers } = await supabaseClient.from('kamer').select('*').order('id');
    const { data: reserveringen } = await supabaseClient.from('reservering').select('*, persoon:persoon_id(*)');

    if (!kamers) return [];

    return kamers.map(k => {
        const kamerRes = (reserveringen || []).filter(r => r.kamer_id === k.id);
        return {
            id: k.id, kamer_nr: k.kamer_nr, hotelid: k.hotel_id, geslacht: k.geslacht, capaciteit: k.capaciteit,
            bezet: kamerRes.length,
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
    const { data } = await supabaseClient.from('reservering').select('*, kamer(*), persoon(*)').eq('id', res_id).single();
    await supabaseClient.from('reservering').delete().eq('id', res_id);
    const u = getCurrentUser();
    if (data) await writeLog('ADMIN_KICK', u.id, `${data.persoon.naam} gekickt uit kamer ${data.kamer.kamer_nr}`);
    return { success: true };
}

async function getAllLeerlingen() {
    const { data } = await supabaseClient.from('persoon').select('*').order('naam');
    return data || [];
}

async function addLeerling(vnaam, naam, geslacht) {
    await supabaseClient.from('persoon').insert([{ vnaam, naam, geslacht, klas: '-', rol: 'LEERLING' }]);
    const u = getCurrentUser();
    await writeLog('ADMIN_ADD_PERSOON', u.id, `${vnaam} ${naam} toegevoegd`);
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
        const lines = csvText.split('\n');
        if (lines.length < 1) return { success: false, message: "Bestand lijkt leeg." };

        let newPersonen = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            const parts = line.split(/[;,]/).map(p => p.trim());
            if (parts.length >= 5) {
                if (i === 0 && (parts[0].toLowerCase() === 'klas' || parts[1].toLowerCase() === 'naam')) continue;
                newPersonen.push({ klas: parts[0], naam: parts[1], vnaam: parts[2], rol: parts[3].toUpperCase(), geslacht: parts[4] ? parts[4].toUpperCase() : null });
            }
        }
        if (newPersonen.length === 0) return { success: false, message: "Geen geldige data gevonden." };
        await supabaseClient.from('persoon').upsert(newPersonen, { onConflict: 'id' });
        const u = getCurrentUser();
        await writeLog('ADMIN_IMPORT_CSV', u.id, `${newPersonen.length} personen geïmporteerd`);
        return { success: true, count: newPersonen.length };
    } catch (e) { return { success: false, message: "Er ging iets mis tijdens het verwerken van de CSV." }; }
}

window.dbApi = {
    login, logout, getCurrentUser, initializeDB, getKamersMetStatus, reserveerPlek,
    bevestigReservatie, checkTimeouts, annuleerPending, searchStudent, searchStudentForLogin,
    syncServerTime, getEstimatedServerTime, verifyTeacherPassword, updateTeacherPassword,
    getAllKamersAdmin, addKamer, addMeerdereKamers, updateKamer, deleteKamer, removeReservatieAdmin,
    getAllLeerlingen, addLeerling, deleteLeerling, importCSVLeerlingen, uploadAfbeelding, // TOEGEVOEGD
    getAppSettings, getReizen, addReis, toggleReisActief, getHotels, addHotel, updateHotel, toggleHotelActief, supabaseClient
};
