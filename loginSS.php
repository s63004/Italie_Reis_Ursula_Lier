<?php
session_start();

// Jouw configuratie
$client_id = '01234abc';
$client_secret = '56789def';
// Oorspronkelijke live URL (bewaar deze voor als je website online gaat)
// $redirect_uri = 'https://reflect.ict.campussintursula.be/loginSS.php';

// Lokale test URL
$redirect_uri = 'http://localhost/Italie%20kamerverdeling/loginSS.php';

// Stap 1: redirect naar externe login
if (isset($_GET['aanmelden'])) {
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
    // In plaats van direct te redirecten, tonen we een formulier om de rest in te vullen.
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
                <!-- Geslacht Keuze -->
                <div id="geslachtField">
                    <label class="block text-sm font-medium text-gray-700 mb-2">Ik ben een...</label>
                    <div class="grid grid-cols-2 gap-4">
                        <label class="cursor-pointer relative">
                            <input type="radio" name="geslacht" value="M" class="peer sr-only" checked>
                            <div class="text-center px-4 py-3 rounded-xl border-2 border-gray-200 peer-checked:bg-orange-50 peer-checked:border-orange-500 peer-checked:text-orange-700 font-medium text-gray-500 transition hover:bg-gray-50">
                                Jongen
                            </div>
                        </label>
                        <label class="cursor-pointer relative">
                            <input type="radio" name="geslacht" value="V" class="peer sr-only">
                            <div class="text-center px-4 py-3 rounded-xl border-2 border-gray-200 peer-checked:bg-orange-50 peer-checked:border-orange-500 peer-checked:text-orange-700 font-medium text-gray-500 transition hover:bg-gray-50">
                                Meisje
                            </div>
                        </label>
                    </div>
                </div>

                <!-- Leerkracht Optie -->
                <div class="flex items-center mt-4 bg-gray-50 p-3 rounded-lg border border-gray-100">
                    <input type="checkbox" id="isLeerkracht" class="w-4 h-4 text-orange-600 rounded border-gray-300 focus:ring-orange-500 cursor-pointer">
                    <label for="isLeerkracht" class="ml-2 text-sm text-gray-600 font-medium cursor-pointer">Ik ben een leerkracht</label>
                </div>

                <!-- Leerkracht Wachtwoord (verborgen tot checkbox is aangevinkt) -->
                <div id="teacherPasswordSection" class="slide-down">
                    <label class="block text-sm font-medium text-gray-700 mb-2">Leerkracht Wachtwoord</label>
                    <div class="relative">
                        <input type="password" id="teacherPassword" placeholder="Voer het leerkracht-wachtwoord in..." class="w-full border border-gray-300 p-3 rounded-xl focus:ring-2 focus:ring-orange-200 focus:border-orange-400 transition pr-10">
                        <svg class="w-5 h-5 text-gray-400 absolute right-3 top-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
                    </div>
                    <p class="text-xs text-gray-400 mt-1">Vraag het wachtwoord aan de beheerder.</p>
                </div>

                <!-- Error message -->
                <div id="loginError" class="hidden bg-red-50 text-red-700 p-3 rounded-xl text-sm border border-red-200 font-medium"></div>

                <button type="submit" id="submitBtn" class="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 px-4 rounded-xl shadow-lg transition flex items-center justify-center gap-2">
                    <span id="submitText">Doorgaan</span>
                    <svg id="submitSpinner" class="hidden w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
                </button>
            </form>
        </div>

        <!-- Inladen van je bestaande database logica -->
        <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
        <script src="js/config.js"></script>
        <script src="js/data.js"></script>
        <script>
            const vnaam = "<?php echo addslashes($voornaam); ?>";
            const naam = "<?php echo addslashes($achternaam); ?>";
            const ssId = "<?php echo addslashes($ssUserID); ?>";

            // Toggle leerkracht wachtwoord veld
            document.getElementById('isLeerkracht').addEventListener('change', function() {
                const section = document.getElementById('teacherPasswordSection');
                if (this.checked) {
                    section.classList.add('open');
                } else {
                    section.classList.remove('open');
                }
            });

            // Check of geslacht al bekend is in de database → skip de vraag
            (async function checkExistingGender() {
                try {
                    const alleLeerlingen = await window.dbApi.getAllLeerlingen();
                    const match = alleLeerlingen.find(l =>
                        l.vnaam.toLowerCase() === vnaam.toLowerCase() &&
                        l.naam.toLowerCase() === naam.toLowerCase()
                    );
                    if (match && match.geslacht) {
                        // Geslacht is al bekend, verberg de keuze en stel in
                        document.getElementById('geslachtField').innerHTML = `
                            <div class="bg-green-50 text-green-700 p-3 rounded-xl border border-green-200 text-sm font-medium flex items-center gap-2">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                                Geslacht: ${match.geslacht === 'M' ? 'Jongen' : 'Meisje'}
                            </div>
                            <input type="hidden" name="geslacht" value="${match.geslacht}">
                        `;
                        document.getElementById('subtitle').innerText = 'Bijna klaar! Bevestig je rol.';
                    }
                } catch(e) { console.log('Gender check overgeslagen'); }
            })();

            document.getElementById('setupForm').addEventListener('submit', async function(e) {
                e.preventDefault();

                const submitBtn = document.getElementById('submitBtn');
                const submitText = document.getElementById('submitText');
                const submitSpinner = document.getElementById('submitSpinner');
                const errorBox = document.getElementById('loginError');

                // Loading state
                submitBtn.disabled = true;
                submitText.innerText = 'Bezig...';
                submitSpinner.classList.remove('hidden');
                errorBox.classList.add('hidden');

                const isLeerkracht = document.getElementById('isLeerkracht').checked;
                const geslachtEl = document.querySelector('input[name="geslacht"]:checked') || document.querySelector('input[name="geslacht"]');
                const geslacht = geslachtEl.value;

                let studentId = ssId;

                try {
                    if (isLeerkracht) {
                        // Verifieer het leerkracht wachtwoord via de database
                        const password = document.getElementById('teacherPassword').value;
                        if (!password) {
                            errorBox.innerText = 'Vul het leerkracht-wachtwoord in.';
                            errorBox.classList.remove('hidden');
                            submitBtn.disabled = false;
                            submitText.innerText = 'Doorgaan';
                            submitSpinner.classList.add('hidden');
                            return;
                        }

                        const isValid = await window.dbApi.verifyTeacherPassword(password);
                        if (!isValid) {
                            errorBox.innerText = 'Ongeldig leerkracht-wachtwoord. Probeer het opnieuw of neem contact op met de beheerder.';
                            errorBox.classList.remove('hidden');
                            submitBtn.disabled = false;
                            submitText.innerText = 'Doorgaan';
                            submitSpinner.classList.add('hidden');
                            return;
                        }

                        await window.dbApi.login(naam, vnaam, geslacht, true, studentId);
                        window.location.href = 'admin.html';
                    } else {
                        const alleLeerlingen = await window.dbApi.getAllLeerlingen();
                        const match = alleLeerlingen.find(l =>
                            l.vnaam.toLowerCase() === vnaam.toLowerCase() &&
                            l.naam.toLowerCase() === naam.toLowerCase()
                        );

                        if (match) {
                            studentId = match.id;
                            await window.dbApi.login(naam, vnaam, geslacht, false, studentId);
                            window.location.href = 'index.html';
                        } else {
                            errorBox.innerText = 'Je staat nog niet in de leerlingenlijst. Vraag je leerkracht om je eerst toe te voegen via de CSV-import.';
                            errorBox.classList.remove('hidden');
                        }
                    }
                } catch (err) {
                    errorBox.innerText = 'Er ging iets mis. Probeer het opnieuw.';
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
