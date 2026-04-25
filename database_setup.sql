-- ============================================================
-- KAMERVERDELING DATABASE SETUP
-- Voer dit uit in de Supabase SQL Editor (volledig bestand)
-- ============================================================

-- 1. pgcrypto extensie voor bcrypt wachtwoord hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- 2. App Settings tabel (voor leerkracht wachtwoord etc.)
-- ============================================================
CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Initieel leerkracht-wachtwoord: "UrsulaItalie2026"
INSERT INTO app_settings (key, value)
VALUES ('teacher_password_hash', crypt('UrsulaItalie2026', gen_salt('bf')))
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 3. RPC: claim_kamer — Atomaire kamer-claim met pessimistic lock
--    Voorkomt race conditions bij gelijktijdige claims
-- ============================================================
CREATE OR REPLACE FUNCTION claim_kamer(
    p_kamer_id BIGINT,
    p_persoon_id TEXT,
    p_hotel_id BIGINT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_capaciteit INT;
    v_bezet INT;
    v_bestaand INT;
    v_has_pending INT;
    v_res_id TEXT;
    v_server_ts BIGINT;
BEGIN
    -- Server timestamp in milliseconden (consistent voor alle clients)
    v_server_ts := (extract(epoch from now()) * 1000)::bigint;

    -- 1. Lock de kamer-rij (pessimistic lock, blokkeert concurrente transacties)
    SELECT capaciteit INTO v_capaciteit
    FROM kamer
    WHERE id = p_kamer_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Kamer bestaat niet.');
    END IF;

    -- 2. Check of gebruiker al een reservering in dit hotel heeft
    SELECT COUNT(*) INTO v_bestaand
    FROM reservering r
    JOIN kamer k ON r.kamer_id = k.id
    WHERE r.persoon_id = p_persoon_id
      AND k.hotel_id = p_hotel_id;

    IF v_bestaand > 0 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Je hebt al een kamer gekozen in dit hotel.');
    END IF;

    -- 3. Check of er al een pending lock op deze kamer zit (door iemand anders)
    --    Alleen niet-verlopen pending reserveringen tellen (< 60 seconden oud)
    SELECT COUNT(*) INTO v_has_pending
    FROM reservering
    WHERE kamer_id = p_kamer_id
      AND status = 'pending'
      AND timestamp > (v_server_ts - 60000);

    IF v_has_pending > 0 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Deze kamer wordt momenteel geconfigureerd door een andere leerling.');
    END IF;

    -- 4. Tel huidige bezetting (alleen confirmed)
    SELECT COUNT(*) INTO v_bezet
    FROM reservering
    WHERE kamer_id = p_kamer_id
      AND status = 'confirmed';

    IF v_bezet >= v_capaciteit THEN
        RETURN jsonb_build_object('success', false, 'message', 'Deze kamer is vol.');
    END IF;

    -- 5. Maak reservering aan met server timestamp
    v_res_id := 'res_' || v_server_ts || '_' || floor(random() * 10000)::int;

    INSERT INTO reservering (id, kamer_id, persoon_id, status, timestamp)
    VALUES (v_res_id, p_kamer_id, p_persoon_id, 'pending', v_server_ts);

    RETURN jsonb_build_object(
        'success', true,
        'res_id', v_res_id,
        'server_ts', v_server_ts
    );
END;
$$;

-- ============================================================
-- 4. RPC: bevestig_kamer — Atomaire bevestiging met roommates
-- ============================================================
CREATE OR REPLACE FUNCTION bevestig_kamer(
    p_persoon_id TEXT,
    p_roommate_ids TEXT[]
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_res RECORD;
    v_kamer_id BIGINT;
    v_capaciteit INT;
    v_bezet INT;
    v_rm_id TEXT;
    v_res_id TEXT;
    v_server_ts BIGINT;
BEGIN
    v_server_ts := (extract(epoch from now()) * 1000)::bigint;

    -- 1. Vind de pending reservering van de gebruiker
    SELECT r.id, r.kamer_id INTO v_res
    FROM reservering r
    WHERE r.persoon_id = p_persoon_id
      AND r.status = 'pending'
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Geen actieve selectie gevonden of tijd is verstreken.');
    END IF;

    v_kamer_id := v_res.kamer_id;

    -- 2. Lock de kamer
    SELECT capaciteit INTO v_capaciteit
    FROM kamer WHERE id = v_kamer_id FOR UPDATE;

    -- 3. Tel bezetting (alleen confirmed, exclusief eigen pending)
    SELECT COUNT(*) INTO v_bezet
    FROM reservering
    WHERE kamer_id = v_kamer_id
      AND status = 'confirmed';

    -- Check: huidige confirmed + 1 (zichzelf) + roommates <= capaciteit
    IF v_bezet + 1 + coalesce(array_length(p_roommate_ids, 1), 0) > v_capaciteit THEN
        RETURN jsonb_build_object('success', false, 'message', 'Te veel personen voor deze kamer.');
    END IF;

    -- 4. Bevestig eigen reservering
    UPDATE reservering SET status = 'confirmed' WHERE id = v_res.id;

    -- 5. Voeg roommates toe als confirmed
    IF p_roommate_ids IS NOT NULL AND array_length(p_roommate_ids, 1) > 0 THEN
        FOREACH v_rm_id IN ARRAY p_roommate_ids LOOP
            -- Check of roommate niet al ergens in dit hotel zit
            PERFORM 1
            FROM reservering r
            JOIN kamer k ON r.kamer_id = k.id
            WHERE r.persoon_id = v_rm_id
              AND k.hotel_id = (SELECT hotel_id FROM kamer WHERE id = v_kamer_id);

            IF FOUND THEN
                -- Rollback eigen bevestiging
                UPDATE reservering SET status = 'pending' WHERE id = v_res.id;
                RETURN jsonb_build_object('success', false, 'message',
                    'Een van je vrienden heeft al een kamer in dit hotel.');
            END IF;

            v_res_id := 'res_' || v_server_ts || '_' || floor(random() * 10000)::int;
            INSERT INTO reservering (id, kamer_id, persoon_id, status, timestamp)
            VALUES (v_res_id, v_kamer_id, v_rm_id, 'confirmed', v_server_ts);
        END LOOP;
    END IF;

    RETURN jsonb_build_object('success', true);
END;
$$;

-- ============================================================
-- 5. RPC: cleanup_expired_pending — Verwijder verlopen pending reserveringen
-- ============================================================
DROP FUNCTION IF EXISTS cleanup_expired_pending();
CREATE OR REPLACE FUNCTION cleanup_expired_pending()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_deleted INT;
    v_server_ts BIGINT;
BEGIN
    v_server_ts := (extract(epoch from now()) * 1000)::bigint;

    DELETE FROM reservering
    WHERE status = 'pending'
      AND timestamp < (v_server_ts - 60000);

    GET DIAGNOSTICS v_deleted = ROW_COUNT;

    RETURN jsonb_build_object('deleted', v_deleted, 'server_ts', v_server_ts);
END;
$$;

-- ============================================================
-- 6. RPC: get_server_time — Geeft de huidige server-timestamp terug
-- ============================================================
CREATE OR REPLACE FUNCTION get_server_time()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN jsonb_build_object('server_ts', (extract(epoch from now()) * 1000)::bigint);
END;
$$;

-- ============================================================
-- 7. RPC: verify_teacher_password — Leerkracht wachtwoord verificatie
-- ============================================================
CREATE OR REPLACE FUNCTION verify_teacher_password(p_password TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_hash TEXT;
BEGIN
    SELECT value INTO v_hash FROM app_settings WHERE key = 'teacher_password_hash';
    IF NOT FOUND THEN RETURN FALSE; END IF;
    RETURN v_hash = crypt(p_password, v_hash);
END;
$$;

-- ============================================================
-- 8. RPC: update_teacher_password — Leerkracht wachtwoord wijzigen
-- ============================================================
CREATE OR REPLACE FUNCTION update_teacher_password(p_old_password TEXT, p_new_password TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_hash TEXT;
BEGIN
    SELECT value INTO v_hash FROM app_settings WHERE key = 'teacher_password_hash';

    IF NOT FOUND OR v_hash != crypt(p_old_password, v_hash) THEN
        RETURN FALSE;
    END IF;

    UPDATE app_settings
    SET value = crypt(p_new_password, gen_salt('bf')),
        updated_at = now()
    WHERE key = 'teacher_password_hash';

    RETURN TRUE;
END;
$$;

-- ============================================================
-- 9. Row Level Security (RLS) voor app_settings
--    Alleen de SECURITY DEFINER functies mogen lezen/schrijven
-- ============================================================
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- Geen directe toegang voor anon role
-- De functies hierboven draaien als SECURITY DEFINER (= superuser context)
-- dus die omzeilen RLS automatisch.

-- ============================================================
-- KLAAR! Alle database-functies zijn aangemaakt.
-- ============================================================
