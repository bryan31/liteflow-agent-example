const deck = document.getElementById('flip-deck');
const button = document.getElementById('flip-page');
const label = document.getElementById('flip-label');
const faces = { support: document.getElementById('support-page'), custom: document.getElementById('custom-page') };
let page = 'support';
let turning = false;

function resize() { deck.style.height = `${faces[page].offsetHeight}px`; }
function syncButton() {
    button.disabled = turning || [...document.querySelectorAll('form[aria-busy]')].some(form => form.getAttribute('aria-busy') === 'true');
}
const observer = new ResizeObserver(resize);
Object.values(faces).forEach(face => observer.observe(face));
window.addEventListener('decision-busychange', syncButton);

button.addEventListener('click', () => {
    if (button.disabled) return;
    page = page === 'support' ? 'custom' : 'support';
    turning = true;
    Object.entries(faces).forEach(([name, face]) => {
        face.inert = name !== page;
        face.setAttribute('aria-hidden', String(name !== page));
    });
    deck.dataset.page = page;
    label.textContent = page === 'custom' ? '返回客服分流' : '切换到自由决策';
    const title = page === 'custom' ? '自由决策演示' : '客服分流演示';
    document.getElementById('page-brand').textContent = title;
    document.title = title;
    resize();
    syncButton();
    window.scrollTo({ top: 0, behavior: 'auto' });
    const finish = () => {
        turning = false;
        syncButton();
        const heading = faces[page].querySelector('h1');
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
    else setTimeout(finish, 650);
});
resize();
syncButton();
