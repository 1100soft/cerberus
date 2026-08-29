const tabs = ["home", "contact"];

function currentTab() {
  const hash = window.location.hash.replace("#", "").toLowerCase();
  return tabs.includes(hash) ? hash : "home";
}

function showTab(name) {
  const tab = tabs.includes(name) ? name : "home";
  document.querySelectorAll("[data-panel]").forEach((panel) => {
    const active = panel.dataset.panel === tab;
    panel.classList.toggle("active", active);
    panel.toggleAttribute("hidden", !active);
  });
  document.querySelectorAll(".tab-nav .tab-link").forEach((link) => {
    const active = link.dataset.tab === tab;
    link.classList.toggle("active", active);
    link.setAttribute("aria-selected", String(active));
  });
  if (window.location.hash.replace("#", "") !== tab) {
    history.replaceState(null, "", `#${tab}`);
  }
  const frame = document.querySelector(".page-frame");
  if (frame) frame.scrollTop = 0;
}

document.addEventListener("click", (event) => {
  const trigger = event.target.closest("[data-tab]");
  if (!trigger) return;
  event.preventDefault();
  showTab(trigger.dataset.tab);
});

window.addEventListener("hashchange", () => showTab(currentTab()));

document.getElementById("year").textContent = String(new Date().getFullYear());
showTab(currentTab());

const form = document.getElementById("contact-form");
const status = document.getElementById("contact-status");

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(form);
  status.classList.remove("success", "error");
  if (String(data.get("website") || "").trim()) {
    status.textContent = "Thanks.";
    status.classList.add("success");
    form.reset();
    return;
  }
  const message = String(data.get("message") || "").trim();
  if (message.length < 10) {
    status.textContent = "Please write a slightly longer message.";
    status.classList.add("error");
    return;
  }
  status.textContent = "Thanks. This form is not connected to a mailbox yet.";
  status.classList.add("success");
  form.reset();
});
