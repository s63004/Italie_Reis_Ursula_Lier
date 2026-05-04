// js/footer.js

document.addEventListener("DOMContentLoaded", () => {
    const currentYear = new Date().getFullYear();
    
    const footerHTML = `
        <footer class="bg-white/80 backdrop-blur-md border-t border-slate-200 mt-auto w-full z-40 relative">
            <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
                <div class="flex flex-col md:flex-row justify-between items-center gap-4">
                    <div class="text-sm text-slate-500 font-medium">
                        &copy; ${currentYear} Campus Sint-Ursula. All rights reserved.
                    </div>
                    <div class="text-sm text-slate-500 flex items-center gap-2">
                        <span>Vragen of klachten?</span>
                        <a href="mailto:it@campussintursula.be" class="text-primary-600 hover:text-primary-800 font-bold transition">
                            Contacteer IT-support
                        </a>
                    </div>
                </div>
            </div>
        </footer>
    `;

    // Injecteer de footer aan het einde van de body
    document.body.insertAdjacentHTML('beforeend', footerHTML);
});
