import "./styles.css";

const menuButton = document.querySelector("[data-menu-button]");
const menu = document.querySelector("[data-menu]");

menuButton?.addEventListener("click", () => {
  const isOpen = menuButton.getAttribute("aria-expanded") === "true";
  menuButton.setAttribute("aria-expanded", String(!isOpen));
  menu?.classList.toggle("open", !isOpen);
});

menu?.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    menuButton?.setAttribute("aria-expanded", "false");
    menu?.classList.remove("open");
  });
});

const platform = (() => {
  const value = navigator.userAgent.toLowerCase();
  if (value.includes("mac")) return "macOS";
  if (value.includes("win")) return "Windows";
  if (value.includes("linux")) return "Linux";
  return null;
})();

if (platform) {
  document.querySelectorAll("[data-download-label]").forEach((label) => {
    label.textContent = `下载 ${platform} 版本`;
  });
}

const header = document.querySelector("[data-header]");
const updateHeader = () => header?.classList.toggle("scrolled", window.scrollY > 12);
updateHeader();
window.addEventListener("scroll", updateHeader, { passive: true });

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.12 },
);

document.querySelectorAll(".reveal").forEach((element) => observer.observe(element));

const copyButton = document.querySelector("[data-copy]");
const command = document.querySelector("[data-command]");

copyButton?.addEventListener("click", async () => {
  if (!command) return;
  const text = Array.from(command.childNodes)
    .map((node) => node.nodeType === Node.TEXT_NODE ? node.textContent : node.classList?.contains("prompt") ? "$" : node.classList?.contains("success") ? "" : node.textContent)
    .join("")
    .split("\n")
    .filter((line) => !line.includes("✓"))
    .map((line) => line.replace(/^\$\s*/, ""))
    .filter(Boolean)
    .join("\n");

  await navigator.clipboard.writeText(text);
  const label = copyButton.querySelector("span");
  if (label) label.textContent = "已复制";
  setTimeout(() => {
    if (label) label.textContent = "复制";
  }, 1800);
});

document.querySelectorAll("[data-year]").forEach((node) => {
  node.textContent = String(new Date().getFullYear());
});
