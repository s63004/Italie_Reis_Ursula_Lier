// config.js - Bevat alle instellingen en keys

const config = {
    supabaseUrl: 'https://zwtviuaqnwjxuoybdnnp.supabase.co',

    // We gebruiken de originele JWT 'anon' sleutel (start met eyJ) omdat de 'sb_publishable' sleutel niet geaccepteerd wordt door de API gateway.
    publishableKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp3dHZpdWFxbndqeHVveWJkbm5wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY5NTY0NTUsImV4cCI6MjA5MjUzMjQ1NX0.1fyQg8VuVbbDR2V07hUN0H9FvMkAccUhqQ-bSGAQg2E',
    
    secretKey: ''
};

window.appConfig = config;
