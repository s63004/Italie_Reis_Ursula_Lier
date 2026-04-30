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
    // Stap 5: Automatisch Inloggen (Geen formulier meer nodig)
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
        <title>Aanmelden...</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
        <style>
            body { font-family: 'Inter', sans-serif; background-color: #f3f4f6; }
        </style>
    </head>
    <body class="min-h-screen flex items-center justify-center p-4">
        <div class="bg-white w-full max-w-md rounded-2xl p-8 shadow-xl border border-gray-100 text-center">
            
            <svg id="loadingSpinner" class="w-12 h-12 animate-spin text-blue-600 mx-auto mb-4" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            
            <h2 id="statusTitle" class="text-xl font-bold text-gray-800 mb-2">Bezig met inloggen...</h2>
            <p id="statusDesc" class="text-sm text-gray-500">We controleren je gegevens, een moment geduld.</p>
            
            <div id="loginError" class="hidden mt-4 bg-red-50 text-red-700 p-4 rounded-xl text-sm border border-red-200 font-medium text-left"></div>
            
            <button id="backBtn" onclick="window.location.href='login.html'" class="hidden mt-6 w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-3 px-4 rounded-xl transition">
                Terug naar het inlogscherm
            </button>
        </div>

        <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
        <script src="js/config.js"></script>
        <script src="js/data.js"></script>
        <script>
            const vnaam = "<?php echo addslashes($voornaam); ?>";
            const naam = "<?php echo addslashes($achternaam); ?>";
            const ssId = "<?php echo addslashes($ssUserID); ?>";
            
            const targetSchoolId = <?php echo isset($_SESSION['ss_login_school']) ? intval($_SESSION['ss_login_school']) : 'null'; ?>;
            const targetReisId = <?php echo isset($_SESSION['ss_login_reis']) ? intval($_SESSION['ss_login_reis']) : 'null'; ?>;

            function showError(msg) {
                document.getElementById('loadingSpinner').classList.add('hidden');
                document.getElementById('statusTitle').innerText = "Inloggen mislukt";
                document.getElementById('statusDesc').classList.add('hidden');
                
                const errorBox = document.getElementById('loginError');
                errorBox.innerText = msg;
                errorBox.classList.remove('hidden');
                
                document.getElementById('backBtn').classList.remove('hidden');
            }

            async function autoLogin() {
                if (!targetSchoolId || !targetReisId) {
                    return showError("Fout: Geen school of activiteit context gevonden. Gelieve opnieuw via de juiste link te starten.");
                }

                try {
                    let sSlug = 'school', sNaam = 'School', rSlug = 'reis', rNaam = 'Reis';
                    
                    const { data: sData } = await window.dbApi.supabaseClient.from('school').select('*').eq('id', targetSchoolId).maybeSingle();
                    if (sData) { sSlug = sData.slug; sNaam = sData.naam; }
                    
                    const { data: rData } = await window.dbApi.supabaseClient.from('reis').select('*').eq('id', targetReisId).maybeSingle();
                    if (rData) { rSlug = rData.slug; rNaam = rData.naam; }

                    const { data: alleLeerlingen } = await window.dbApi.supabaseClient.from('persoon').select('*').eq('school_id', targetSchoolId).eq('rol', 'LEERLING');
                    
                    // We checken de database of de persoon door de admin is toegevoegd
                    const match = (alleLeerlingen || []).find(l =>
                        l.vnaam.toLowerCase() === vnaam.toLowerCase() &&
                        l.naam.toLowerCase() === naam.toLowerCase()
                    );

                    if (match) {
                        await window.dbApi.login(naam, vnaam, match.geslacht, false, match.id, targetSchoolId, sSlug, sNaam, targetReisId, rSlug, rNaam);
                        window.location.href = 'index.html';
                    } else {
                        showError("Je bent niet gevonden in de leerlingenlijst van deze school (" + vnaam + " " + naam + "). Vraag je leerkracht om je eerst toe te voegen in het beheerpaneel.");
                    }
                } catch (err) {
                    console.error('Login error:', err);
                    showError("Er is een verbindingsfout met de database opgetreden. Probeer het later opnieuw.");
                }
            }

            document.addEventListener('DOMContentLoaded', autoLogin);
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
