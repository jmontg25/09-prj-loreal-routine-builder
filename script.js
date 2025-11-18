/* Get references to DOM elements */
const categoryFilter = document.getElementById("categoryFilter");
const productsContainer = document.getElementById("productsContainer");
const chatForm = document.getElementById("chatForm");
const chatWindow = document.getElementById("chatWindow");
const searchInput = document.getElementById("searchInput");
const selectedProductsList = document.getElementById("selectedProductsList");
const generateRoutineBtn = document.getElementById("generateRoutine");
const clearSelectionsBtn = document.getElementById("clearSelections");

const workerUrl = "https://wanderbot-worker.jmontg25.workers.dev/"; // user's worker

let productsCache = [];
let selectedIds = new Set();
let conversationMessages = []; // stores {role, content} messages for worker

/* initial UI placeholder */
productsContainer.innerHTML = `
  <div class="placeholder-message">
    Select a category or search to view products
  </div>
`;

/* Load product data from JSON file (cached) */
async function loadProducts() {
  if (productsCache.length) return productsCache;
  const resp = await fetch("products.json");
  const data = await resp.json();
  productsCache = data.products || [];
  return productsCache;
}

/* Helpers */
function saveSelectedToStorage() {
  localStorage.setItem(
    "selectedProductIds",
    JSON.stringify(Array.from(selectedIds))
  );
}

function restoreSelectedFromStorage() {
  try {
    const raw = localStorage.getItem("selectedProductIds");
    if (!raw) return;
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) arr.forEach((id) => selectedIds.add(id));
  } catch (e) {
    console.warn("Could not restore selected products", e);
  }
}

/* Render product cards */
function renderProducts(list) {
  if (!list || !list.length) {
    productsContainer.innerHTML = `<div class="placeholder-message">No products found</div>`;
    return;
  }

  productsContainer.innerHTML = list
    .map((p) => {
      const isSelected = selectedIds.has(p.id);
      return `
      <div class="product-card ${isSelected ? "selected" : ""}" data-id="${
        p.id
      }">
        <img src="${p.image}" alt="${escapeHtml(p.name)}">
        <div class="product-info">
          <h3>${escapeHtml(p.name)}</h3>
          <p>${escapeHtml(p.brand)} • ${escapeHtml(p.category)}</p>
          <div class="meta-row">
            <button class="toggle-desc-btn" aria-expanded="false">Details</button>
            <small class="tiny">Tap card to select</small>
          </div>
          <div class="desc">${escapeHtml(p.description)}</div>
        </div>
      </div>
    `;
    })
    .join("");

  // attach listeners
  productsContainer.querySelectorAll(".product-card").forEach((card) => {
    const id = Number(card.getAttribute("data-id"));
    const toggleBtn = card.querySelector(".toggle-desc-btn");

    card.addEventListener("click", (e) => {
      // if clicking the toggle button, don't toggle selection
      if (e.target === toggleBtn) return;
      toggleSelect(id, card);
    });

    toggleBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const expanded = card.classList.toggle("expanded");
      toggleBtn.setAttribute("aria-expanded", expanded ? "true" : "false");
    });
  });
}

function toggleSelect(id, cardEl) {
  if (selectedIds.has(id)) {
    selectedIds.delete(id);
    cardEl.classList.remove("selected");
  } else {
    selectedIds.add(id);
    cardEl.classList.add("selected");
  }
  saveSelectedToStorage();
  renderSelectedList();
}

function renderSelectedList() {
  if (!selectedProductsList) return;
  const products = productsCache.filter((p) => selectedIds.has(p.id));
  if (!products.length) {
    selectedProductsList.innerHTML = `<div class="placeholder-message">No products selected</div>`;
    return;
  }

  selectedProductsList.innerHTML = products
    .map(
      (p) => `
      <div class="selected-item" data-id="${p.id}">
        <strong>${escapeHtml(p.name)}</strong>
        <button aria-label="Remove ${escapeHtml(p.name)}">&times;</button>
      </div>
    `
    )
    .join("");

  selectedProductsList
    .querySelectorAll(".selected-item button")
    .forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const parent = e.currentTarget.closest(".selected-item");
        const id = Number(parent.getAttribute("data-id"));
        selectedIds.delete(id);
        saveSelectedToStorage();
        // update product card visual if present
        const card = productsContainer.querySelector(
          `.product-card[data-id='${id}']`
        );
        if (card) card.classList.remove("selected");
        renderSelectedList();
      });
    });
}

function clearAllSelections() {
  selectedIds.clear();
  saveSelectedToStorage();
  renderSelectedList();
  // remove visual selected state from cards
  productsContainer
    .querySelectorAll(".product-card.selected")
    .forEach((c) => c.classList.remove("selected"));
}

/* basic search + category filter that work together */
let searchTimeout = null;
async function filterAndRender() {
  const all = await loadProducts();
  const category = categoryFilter.value;
  const q = (searchInput.value || "").trim().toLowerCase();

  let filtered = all.slice();
  // treat "all" (default) as no category filter
  if (category && category !== "all")
    filtered = filtered.filter((p) => p.category === category);
  if (q) {
    filtered = filtered.filter((p) => {
      return (
        p.name.toLowerCase().includes(q) ||
        p.brand.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q)
      );
    });
  }

  renderProducts(filtered);
}

categoryFilter.addEventListener("change", () => filterAndRender());
searchInput.addEventListener("input", () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(filterAndRender, 180);
});

/* Chat helpers + worker integration */
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function appendChat(role, text) {
  const div = document.createElement("div");
  if (role === "assistant") {
    div.className = "ai-msg";
    div.innerHTML = `<div>${escapeHtml(text).replace(/\n/g, "<br>")}</div>`;
  } else {
    div.className = "user-msg";
    div.textContent = text;
  }
  chatWindow.appendChild(div);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

async function callWorker(payload) {
  try {
    const resp = await fetch(workerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await resp.json();
    // worker may return {reply: '...'} or {text: '...'} or {choices:[{message:{content:...}}]}
    if (json.reply) return json.reply;
    if (json.text) return json.text;
    if (json.choices && json.choices[0] && json.choices[0].message)
      return json.choices[0].message.content;
    // fallback: stringify
    return JSON.stringify(json);
  } catch (err) {
    console.error(err);
    return `Error: ${err.message || err}`;
  }
}

/* When user clicks Generate Routine */
generateRoutineBtn.addEventListener("click", async () => {
  if (!selectedIds.size) {
    appendChat(
      "assistant",
      "Please select at least one product to generate a routine."
    );
    return;
  }

  const products = productsCache
    .filter((p) => selectedIds.has(p.id))
    .map((p) => ({
      name: p.name,
      brand: p.brand,
      category: p.category,
      description: p.description,
    }));

  // build initial system + user messages
  conversationMessages = [
    {
      role: "system",
      content:
        "You are a helpful beauty advisor. Provide a concise step-by-step routine using the provided products. Mention when to use each product (AM/PM), order, and short reason.",
    },
    {
      role: "user",
      content: `Please create a personalized routine using these selected products:\n${products
        .map(
          (p) => `- ${p.brand} — ${p.name} (${p.category}): ${p.description}`
        )
        .join("\n")}`,
    },
  ];

  appendChat(
    "assistant",
    "Generating routine...\n(This may take a few seconds)"
  );
  const reply = await callWorker({
    messages: conversationMessages,
    selectedProducts: products,
    type: "generate_routine",
  });

  // remove the 'generating...' placeholder (last assistant message) and append the real reply
  // simple approach: append reply normally
  appendChat("assistant", reply);
  // store assistant response in conversation history for follow-ups
  conversationMessages.push({ role: "assistant", content: reply });
});

/* Chat form handles follow-up questions (only after generating routine ideally) */
chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("userInput");
  const text = input.value.trim();
  if (!text) return;
  appendChat("user", text);

  // add user message to conversation history
  conversationMessages.push({ role: "user", content: text });

  // call worker with the conversationMessages to continue the chat
  appendChat("assistant", "Thinking...");
  const reply = await callWorker({
    messages: conversationMessages,
    type: "follow_up",
  });
  appendChat("assistant", reply);
  conversationMessages.push({ role: "assistant", content: reply });
  input.value = "";
});

clearSelectionsBtn.addEventListener("click", () => {
  clearAllSelections();
});

/* boot */
(async function boot() {
  await loadProducts();
  restoreSelectedFromStorage();
  renderSelectedList();
  filterAndRender();
})();
