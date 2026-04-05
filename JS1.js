// ─── CURSOR ──────────────────────────────────────────────────────────────────
// FIX: removed .animate() — it was running in parallel with style assignment
// causing the jitter. Direct style assignment is instant and smooth.
const cursor = document.querySelector(".cursor-circle");

window.addEventListener("mousemove", function (event) {
    cursor.style.left = `${event.clientX}px`;
    cursor.style.top  = `${event.clientY}px`;
});


// ─── SCROLL PARALLAX ─────────────────────────────────────────────────────────
// FIX: requestAnimationFrame prevents style thrash on every scroll pixel.
// FIX: backdrop-filter is cheapened during scroll and restored after stop —
//      this is the main reason the right panel felt laggy while scrolling.
const container    = document.getElementById("contentContainer");
const circle1      = document.querySelector('.circle1');
const circle2      = document.querySelector('.circle2');
const circle3      = document.querySelector('.circle3');
let   ticking      = false;
let   scrollTimer  = null;

container.addEventListener('scroll', function () {
    // Drop blur while scrolling for smooth compositing
    container.classList.add('is-scrolling');

    // Debounce: restore blur 150ms after scrolling stops
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(function () {
        container.classList.remove('is-scrolling');
    }, 150);

    if (!ticking) {
        requestAnimationFrame(function () {
            const s = container.scrollTop;
            circle1.style.transform = `translateY(${s * 0.25}px)`;
            circle2.style.transform = `translateY(${-s * 0.15}px)`;
            circle3.style.transform = `translateX(${s * 0.3}px)`;
            ticking = false;
        });
        ticking = true;
    }
});


// ─── CURSOR HOVER STATES ─────────────────────────────────────────────────────
const cursorCircle = cursor;

function addHover(id, cls) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("mouseover", () => cursorCircle.classList.add(cls));
    el.addEventListener("mouseout",  () => cursorCircle.classList.remove(cls));
}

addHover('pointer1', 'cursor-circle-hover');
addHover('pointer2', 'cursor-circle-hover');
addHover('pointer3', 'cursor-circle-hover');
addHover('pointer4', 'cursor-circle-hover2');
addHover('pointer5', 'cursor-circle-hover3');
addHover('pointer6', 'cursor-circle-hover2');
addHover('pointer7', 'cursor-circle-hover3');
addHover('pointer8', 'cursor-circle-hover');

document.querySelectorAll('.pointer9').forEach(el => {
    el.addEventListener("mouseover", () => cursorCircle.classList.add("cursor-circle-hover4"));
    el.addEventListener("mouseout",  () => cursorCircle.classList.remove("cursor-circle-hover4"));
});


// ─── CIRCLE ARROWS ───────────────────────────────────────────────────────────
const circularArrow = document.querySelector('.circleArr');
const img           = document.getElementById('img');
const note1         = document.getElementById('note1');
const note2         = document.getElementById('note2');

if (circularArrow) {
    circularArrow.addEventListener("mouseover", () => {
        circularArrow.style.backgroundColor = "#FFFFFF";
        img.style.display = "none";
        note1.textContent = "There's a lot more to know!,";
        note2.textContent = "Continue surfing 🤞";
    });
    circularArrow.addEventListener("mouseout", () => {
        circularArrow.style.backgroundColor = "transparent";
        img.style.display = "block";
        note1.textContent = "";
        note2.textContent = "";
    });
}

const circularArrow2 = document.querySelector('.circleArr2');
const img2           = document.getElementById('img2');
const note3          = document.getElementById('note3');
const note4          = document.getElementById('note4');

if (circularArrow2) {
    circularArrow2.addEventListener("mouseover", () => {
        circularArrow2.style.backgroundColor = "#FFFFFF";
        img2.style.display = "none";
        note3.textContent = "Some projects I've built!,";
        note4.textContent = "Continue surfing 🤞";
    });
    circularArrow2.addEventListener("mouseout", () => {
        circularArrow2.style.backgroundColor = "transparent";
        img2.style.display = "block";
        note3.textContent = "";
        note4.textContent = "";
    });
}


// ─── KNOW MORE TOGGLE ────────────────────────────────────────────────────────
const knowMoreBtn = document.getElementById('knowMoreBtn');
const aboutTXT    = document.querySelector('.first-about');
const secondAbout = document.querySelector('.second-about');

knowMoreBtn.addEventListener('click', () => {
    knowMoreBtn.classList.toggle('circular');
    if (knowMoreBtn.classList.contains('circular')) {
        aboutTXT.style.display  = "block";
        secondAbout.style.display = "none";
    } else {
        aboutTXT.style.display  = "none";
        secondAbout.style.display = "flex";
    }
});


// ─── SCROLL REVEAL ───────────────────────────────────────────────────────────
const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
        if (entry.isIntersecting) {
            entry.target.classList.add('show');
            // Stop observing once shown — no need to keep watching
            observer.unobserve(entry.target);
        }
    });
});

document.querySelectorAll('.hidden').forEach((el) => observer.observe(el));


// ─── LOADING SCREEN ──────────────────────────────────────────────────────────
const observer2   = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
        if (entry.isIntersecting) entry.target.classList.add('hide');
    });
});

const circles     = document.querySelectorAll('.circle');
const loadingWrap = document.querySelector('.loading-wrap');
const bodyEle     = document.body;

document.querySelectorAll('.toHide').forEach((el) => observer2.observe(el));

window.onload = function () {
    circles.forEach(c => { c.style.display = "none"; });
    setTimeout(function () {
        loadingWrap.style.display = "none";
        circles.forEach(c => {
            c.style.display  = "block";
            c.style.position = "fixed";
        });
        bodyEle.style.backgroundColor = "#0A0A0A";
    }, 3000);
};