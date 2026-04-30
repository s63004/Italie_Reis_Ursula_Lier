<?php
session_start();

// Jouw configuratie
$client_id = '01234abc';
$client_secret = '56789def';
// Oorspronkelijke live URL (bewaar deze voor als je website online gaat)
// $redirect_uri = 'https://reflect.ict.campussintursula.be/loginSS.php';

// Automatisch de redirect URI bepalen op basis van de huidige locatie
$protocol = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on' ? "https" : "http") . "://";
$host = $_SERVER['HTTP_HOST'];
$pad = $_SERVER['PHP_SELF'];

$redirect_uri = $protocol . $host . $pad;
// Stap 1: redirect naar externe login
if (isset($_GET['aanmelden'])) {
    // NIEUW: Sla de school en reis context op in de sessie VOORDAT we naar Smartschool gaan
    if (isset($_GET['school'])) $_SESSION['ss_login_school'] = $_GET['school'];
    if (isset($_GET['reis'])) $_SESSION['ss_login_reis'] = $_GET['reis'];

    $authorization_url = 'https://leerstof.be/campussintursula/oauth.php' . '?' .
        http_build_query(array(
            'client_id' => $client_id,
            'redirect_uri' => $redirect_uri,
            'scope' => 'userinfo groupinfo',
            'response_type' => 'code'
        ));
    header('Location: ' . $authorization_url);
    exit;
}

// Stap 2: Verwerken van de Callback en Token Aanvraag
if (isset($_GET['code'])) {
    $code = $_GET['code'];
    
    // Stap 3: access_token aanvragen
    $token_url = 'https://leerstof.be/campussintursula/token.php';
    $data = array(
        'grant_type' => 'authorization_code',
        'client_id' => $client_id,
        'client_secret' => $client_secret,
        'redirect_uri' => $redirect_uri,
        'code' => $code
    );
    
    // Context creatie om een POST request te doen via file_get_contents in PHP
    $options = array(
        'http' => array(
            'header'  => "Content-type: application/x-www-form-urlencoded\r\n",
            'method'  => 'POST',
            'content' => http_build_query($data)
        )
    );
    $context  = stream_context_create($options);
    $response = file_get_contents($token_url, false, $context);
    
    if ($response === FALSE) {
        die("<h3>Fout bij het ophalen van het access token. Controleer je secret en client ID.</h3>");
    }
    
    $token = json_decode($response, true);
    $access_token = $token['access_token'];
    
    // Stap 4: Ophalen van Gebruikersgegevens
    $api_userinfo_url = 'https://leerstof.be/campussintursula/userinfo.php?access_token=' . urlencode($access_token);
    $userinfo = json_decode(file_get_contents($api_userinfo_url), true);
    
    $api_groupinfo_url = 'https://leerstof.be/campussintursula/groupinfo.php?access_token=' . urlencode($access_token);
    $groupinfo = json_decode(file_get_contents($api_groupinfo_url), true);
    
    // (Jouw originele code: opslaan in sessie)
    if(isset($userinfo['userID'])) {
        $_SESSION['userID'] = $userinfo['userID'];
        $_SESSION['first_name'] = $userinfo['name'];
        $_SESSION['last_name'] = $userinfo['surname'];
        
        if (isset($groupinfo['groups'])) {
            foreach ($groupinfo['groups'] as $group) {
                $_SESSION['groupID_' . $group['groupID']] = $group;
            }
        }
    }

    // -------------------------------------------------------------------------
    // Stap 5: Profiel Afronden (Geslacht & Rol vragen)
    // -------------------------------------------------------------------------
    
    $voornaam = isset($userinfo['name']) ? htmlspecialchars($userinfo['name'], ENT_QUOTES) : '';
    $achternaam = isset($userinfo['surname']) ? htmlspecialchars($userinfo['surname'], ENT_QUOTES) : '';
    $ssUserID = isset($userinfo['userID']) ? htmlspecialchars($userinfo['userID'], ENT_QUOTES) : '';
    
    ?>
    <!DOCTYPE html>
    <html lang="nl">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Rond je profiel af</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
        <style>
            body { font-family: 'Inter', sans-serif; background-color: #f3f4f6; }
            .slide-down {
                max-height: 0;
                overflow: hidden;
                transition: max-height 0.3s ease-out, opacity 0.3s ease-out;
                opacity: 0;
            }
            .slide-down.open {
                max-height: 200px;
                opacity: 1;
            }
        </style>
    </head>
    <body class="min-h-screen flex items-center justify-center p-4">
        <div class="bg-white w-full max-w-md rounded-2xl p-8 shadow-xl border border-gray-100">
            <h2 class="text-2xl font-bold text-gray-800 mb-2">Welkom, <?php echo $voornaam; ?>!</h2>
            <p class="text-gray-500 mb-6" id="subtitle">Om verder te gaan, hebben we nog even je geslacht en rol nodig.</p>
            
            <form id="setupForm" class="space-y-6">
                <div id="geslachtField">
                    <label class="block text-sm font-medium text-gray-700 mb-2">Ik ben een...</label>
                    <div class="grid grid-cols-2 gap-4">
                        <label class="cursor-pointer relative">
                            <input type="radio" name="geslacht" value="M" class="peer sr-only" checked>
                            <div class="text-center px-4 py-3 rounded-xl border-2 border-gray-200 peer-checked:bg-blue-50 peer-checked:border-blue-500 peer-checked:text-blue-700 font-medium text-gray-500 transition hover:bg-gray-50">
                                Jongen
                            </div>
                        </label>
                        <label class="cursor-pointer relative">
                            <input type="radio" name="geslacht" value="V" class="peer sr-only">
                            <div class="text-center px-4 py-3 rounded-xl border-2 border-gray-200 peer-checked:bg-blue-50 peer-checked:border-blue-500 peer-checked:text-blue-700 font-medium text-gray-500 transition hover:bg-gray-50">
                                Meisje
                            </div>
                        </label>
                    </div>
                </div>

                <div class="flex items-center mt-4 bg-gray-50 p-3 rounded-lg border border-gray-100">
                    <input type="checkbox" id="isLeerkracht" class="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 cursor-pointer">
                    <label for="isLeerkracht" class="ml-2 text-sm text-gray-600 font-medium cursor-pointer">Ik ben een leerkracht</label>
                </div>

                <div id="teacherPasswordSection" class="slide-down">
                    <label class="block text-sm font-medium text-gray-700 mb-2">Leerkracht Wachtwoord</label>
                    <div class="relative">
                        <input type="password" id="teacherPassword" placeholder="Voer het leerkracht-wachtwoord in..." class="w-full border border-gray-300 p-3 rounded-xl focus:ring-2 focus:ring-blue-200 focus:border-blue-400 transition pr-10">
                        <svg class="w-5 h-5 text-gray-400 absolute right-3 top-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
                    </div>
                    <p class="text-xs text-gray-400 mt-1">Vraag het wachtwoord aan de beheerder.</p>
                </div>

                <div id="loginError" class="hidden bg-red-50 text-red-700 p-3 rounded-xl text-sm border border-red-200 font-medium"></div>

                <button type="submit" id="submitBtn" class="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-3 px-4 rounded-xl shadow-lg transition flex items-center justify-center gap-2">
                    <span id="submitText">Doorgaan</span>
                    <svg id="submitSpinner" class="hidden w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
                </button>
            </form>
        </div>

        <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
        <script src="js/config.js"></script>
        <script src="js/data.js"></script>
        <script>
            const vnaam = "<?php echo addslashes($voornaam); ?>";
            const naam = "<?php echo addslashes($achternaam); ?>";
            const ssId = "<?php echo addslashes($ssUserID); ?>";
            
            // Haal de opgeslagen school/reis ID's op uit de sessie via PHP
            const targetSchoolId = <?php echo isset($_SESSION['ss_login_school']) ? intval($_SESSION['ss_login_school']) : 'null'; ?>;
            const targetReisId = <?php echo isset($_SESSION['ss_login_reis']) ? intval($_SESSION['ss_login_reis']) : 'null'; ?>;

            if (!targetSchoolId) {
                alert("Fout: Geen school context gevonden. Gelieve de juiste link te gebruiken.");
            }

            document.getElementById('isLeerkracht').addEventListener('change', function() {
                const section = document.getElementById('teacherPasswordSection');
                if (this.checked) section.classList.add('open');
                else section.classList.remove('open');
            });

            // Check of geslacht al bekend is in de database (direct via Supabase omdat user nog niet actief is)
            (async function checkExistingGender() {
                if(!targetSchoolId) return;
                try {
                    const { data: alleLeerlingen } = await window.dbApi.supabaseClient.from('persoon').select('*').eq('school_id', targetSchoolId);
                    const match = (alleLeerlingen || []).find(l =>
                        l.vnaam.toLowerCase() === vnaam.toLowerCase() &&
                        l.naam.toLowerCase() === naam.toLowerCase()
                    );
                    
                    if (match && match.geslacht) {
                        document.getElementById('geslachtField').innerHTML = `
                            <div class="bg-green-50 text-green-700 p-3 rounded-xl border border-green-200 text-sm font-medium flex items-center gap-2">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                                Geslacht is bekend: ${match.geslacht === 'M' ? 'Jongen' : 'Meisje'}
                            </div>
                            <input type="hidden" name="geslacht" value="${match.geslacht}">
                        `;
                        document.getElementById('subtitle').innerText = 'Bijna klaar! Bevestig je rol.';
                    }
                } catch(e) { console.log('Gender check overgeslagen', e); }
            })();

            document.getElementById('setupForm').addEventListener('submit', async function(e) {
                e.preventDefault();

                if(!targetSchoolId) return;

                const submitBtn = document.getElementById('submitBtn');
                const submitText = document.getElementById('submitText');
                const submitSpinner = document.getElementById('submitSpinner');
                const errorBox = document.getElementById('loginError');

                submitBtn.disabled = true;
                submitText.innerText = 'Bezig...';
                submitSpinner.classList.remove('hidden');
                errorBox.classList.add('hidden');

                const isLeerkracht = document.getElementById('isLeerkracht').checked;
                const geslachtEl = document.querySelector('input[name="geslacht"]:checked') || document.querySelector('input[name="geslacht"]');
                const geslacht = geslachtEl.value;

                let studentId = ssId;
                
                // Haal de specifieke namen en slugs op om de sessie volledig in te vullen
                let sSlug = 'school', sNaam = 'School', rSlug = 'reis', rNaam = 'Reis';
                try {
                    if (targetSchoolId) {
                        const { data: sData } = await window.dbApi.supabaseClient.from('school').select('*').eq('id', targetSchoolId).maybeSingle();
                        if (sData) { sSlug = sData.slug; sNaam = sData.naam; }
                    }
                    if (targetReisId) {
                        const { data: rData } = await window.dbApi.supabaseClient.from('reis').select('*').eq('id', targetReisId).maybeSingle();
                        if (rData) { rSlug = rData.slug; rNaam = rData.naam; }
                    }
                } catch(err) { console.warn("Context ophalen faalde", err); }

                try {
                    if (isLeerkracht) {
                        const password = document.getElementById('teacherPassword').value;
                        if (!password) {
                            errorBox.innerText = 'Vul het leerkracht-wachtwoord in.';
                            errorBox.classList.remove('hidden');
                            submitBtn.disabled = false; submitText.innerText = 'Doorgaan'; submitSpinner.classList.add('hidden');
                            return;
                        }

                        const isValid = await window.dbApi.verifyTeacherPassword(password, targetSchoolId);
                        if (!isValid) {
                            errorBox.innerText = 'Ongeldig leerkracht-wachtwoord. Probeer het opnieuw of neem contact op met de beheerder.';
                            errorBox.classList.remove('hidden');
                            submitBtn.disabled = false; submitText.innerText = 'Doorgaan'; submitSpinner.classList.add('hidden');
                            return;
                        }

                        await window.dbApi.login(naam, vnaam, geslacht, true, studentId, targetSchoolId, sSlug, sNaam, targetReisId, rSlug, rNaam);
                        window.location.href = 'admin.html';
                    } else {
                        const { data: alleLeerlingen } = await window.dbApi.supabaseClient.from('persoon').select('*').eq('school_id', targetSchoolId).eq('rol', 'LEERLING');
                        const match = (alleLeerlingen || []).find(l =>
                            l.vnaam.toLowerCase() === vnaam.toLowerCase() &&
                            l.naam.toLowerCase() === naam.toLowerCase()
                        );

                        if (match) {
                            studentId = match.id;
                            await window.dbApi.login(naam, vnaam, geslacht, false, studentId, targetSchoolId, sSlug, sNaam, targetReisId, rSlug, rNaam);
                            window.location.href = 'index.html';
                        } else {
                            errorBox.innerText = 'Je staat nog niet in de leerlingenlijst. Vraag je leerkracht om je eerst toe te voegen.';
                            errorBox.classList.remove('hidden');
                        }
                    }
                } catch (err) {
                    errorBox.innerText = 'Er ging iets mis met het verbinden met de database. Probeer het opnieuw.';
                    errorBox.classList.remove('hidden');
                    console.error('Login error:', err);
                }

                submitBtn.disabled = false;
                submitText.innerText = 'Doorgaan';
                submitSpinner.classList.add('hidden');
            });
        </script>
    </body>
    </html>
    <?php
    exit;
}

// Standaard landingspagina met test-knop
?>
<!DOCTYPE html>
<html lang="nl">
<head>
    <meta charset="UTF-8">
    <title>Test Smartschool OAuth</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f3f4f6; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
        .card { background: white; padding: 40px; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.1); text-align: center; max-width: 500px; }
        .btn { display: inline-block; padding: 15px 30px; margin-top: 20px; font-size: 16px; font-weight: bold; background-color: #f97316; color: white; text-decoration: none; border-radius: 8px; transition: transform 0.2s, background 0.2s; }
        .btn:hover { background-color: #ea580c; transform: translateY(-2px); }
    </style>
</head>
<body>
    <div class="card">
        <h2 style="color: #1f2937; margin-bottom: 10px;">Smartschool API Test</h2>
        <p style="color: #6b7280; line-height: 1.5;">Klik op de onderstaande knop om de Smartschool redirect te simuleren. Zodra je terugkomt, printen we alle verborgen data uit!</p>
        <a href="?aanmelden=1" class="btn">Login met Smartschool</a>
    </div>
</body>
</html>
