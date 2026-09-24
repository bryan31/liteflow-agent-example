const deck = document.getElementById('flip-deck');
const button = document.getElementById('flip-page');
const label = document.getElementById('flip-label');
const faces = {
    support: document.getElementById('support-page'),
    judge: document.getElementById('judge-page'),
    custom: document.getElementById('custom-page')
};
const order = ['support', 'judge', 'custom'];
const titles = { support: '客服分流演示', judge: '是非判断演示', custom: '自由决策演示' };
const nextLabels = { support: '切换到是非判断', judge: '切换到自由决策', custom: '返回客服分流' };
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
    const next = order[(order.indexOf(page) + 1) % order.length];
    turning = true;
    // The deck flips between two faces: the current page and the next one as its back.
    for (const [name, face] of Object.entries(faces)) {
        const involved = name === page || name === next;
        face.hidden = !involved;
        face.style.transform = name === next ? 'rotateY(180deg)' : '';
        face.inert = name !== next;
        face.setAttribute('aria-hidden', String(name !== next));
    }
    deck.getBoundingClientRect();
    deck.classList.add('flipped');
    window.scrollTo({ top: 0, behavior: 'auto' });
    const settle = () => {
        page = next;
        deck.style.transition = 'none';
        deck.classList.remove('flipped');
        for (const [name, face] of Object.entries(faces)) {
            face.hidden = name !== page;
            face.style.transform = '';
        }
        deck.getBoundingClientRect();
        deck.style.transition = '';
        label.textContent = nextLabels[page];
        document.getElementById('page-brand').textContent = titles[page];
        document.title = titles[page];
        resize();
        turning = false;
        syncButton();
        const heading = faces[page].querySelector('h1');
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) settle();
    else setTimeout(settle, 650);
});
resize();
syncButton();
