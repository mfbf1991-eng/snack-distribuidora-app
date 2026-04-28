import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import express from "express";
import cors from "cors";
import ExcelJS from "exceljs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webDistPath = path.resolve(__dirname, "..", "dist");
const webIndexPath = path.join(webDistPath, "index.html");
const isProduction = String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";
const allowSystemMutationInProd = String(process.env.ALLOW_SYSTEM_MUTATION_IN_PROD || "").trim().toLowerCase() === "true";
const systemMutationToken = String(process.env.SYSTEM_MUTATION_TOKEN || "").trim();
const forcePersistentPaths = String(process.env.FORCE_PERSISTENT_PATHS || "true").trim().toLowerCase() !== "false";

function isTmpLikePath(value) {
  const normalized = String(value || "").trim().replace(/\\/g, "/").toLowerCase();
  return normalized.startsWith("/tmp/") || normalized === "/tmp" || normalized.includes("/tmp/");
}

function resolveDataPath(envValue, fallbackLocalPath, fallbackProdPath) {
  const raw = String(envValue || "").trim();
  const candidate = raw ? path.resolve(raw) : isProduction ? fallbackProdPath : fallbackLocalPath;
  if (isProduction && forcePersistentPaths && isTmpLikePath(candidate)) {
    return fallbackProdPath;
  }
  return candidate;
}

const dbPath = resolveDataPath(process.env.DB_PATH, path.join(__dirname, "data", "db.json"), "/data/db.json");
const backupsDir = resolveDataPath(process.env.BACKUPS_DIR, path.join(__dirname, "data", "backups"), "/data/backups");
const DEFAULT_SUGGESTION_MIN = 8;

const app = express();
const PORT = process.env.PORT || 4000;

if (isProduction) {
  console.log(`[config] DB_PATH=${dbPath}`);
  console.log(`[config] BACKUPS_DIR=${backupsDir}`);
  if (dbPath.startsWith("/tmp") || backupsDir.startsWith("/tmp")) {
    console.warn("[config] WARNING: rutas temporales detectadas en produccion.");
  }
}

app.use(cors());
app.use(express.json());

if (fs.existsSync(webIndexPath)) {
  app.use(express.static(webDistPath));
}

function parseNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function uid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function cleanDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function hashPin(pin) {
  return crypto.createHash("sha256").update(String(pin || "").trim()).digest("hex");
}

function normalizeSellerUser(rawUser = {}) {
  return {
    id: String(rawUser.id || uid("seller_user")).trim(),
    sellerId: String(rawUser.sellerId || "").trim(),
    username: String(rawUser.username || "").trim().toLowerCase(),
    pinHash: String(rawUser.pinHash || "").trim(),
    active: rawUser.active !== false,
    createdAt: String(rawUser.createdAt || new Date().toISOString())
  };
}

function ensureDefaultSellerUsers(data, sellers) {
  const existing = Array.isArray(data.sellerUsers) ? data.sellerUsers.map(normalizeSellerUser) : [];
  const users = [...existing];
  let changed = false;

  const sellerOnly = sellers.filter((seller) => seller.role === "seller" && seller.active);
  for (let i = 0; i < sellerOnly.length; i += 1) {
    const seller = sellerOnly[i];
    const hasUser = users.some((user) => user.sellerId === seller.id && user.active);
    if (hasUser) continue;
    const username = i === 0 ? "edwin" : `vendedor${i + 1}`;
    users.push(
      normalizeSellerUser({
        sellerId: seller.id,
        username,
        pinHash: hashPin("1234"),
        active: true
      })
    );
    changed = true;
  }

  // Keep first seller login aligned with the default seller profile name.
  const defaultSeller = sellerOnly[0];
  if (defaultSeller && defaultSeller.id === "seller_ext_01") {
    const idx = users.findIndex((user) => user.sellerId === "seller_ext_01" && user.active);
    if (idx >= 0 && String(users[idx].username || "").trim().toLowerCase() === "vendedor1") {
      users[idx] = { ...users[idx], username: "edwin" };
      changed = true;
    }
  }
  return { users, changed };
}

function newSessionToken() {
  return crypto.randomBytes(24).toString("hex");
}

function nowIso() {
  return new Date().toISOString();
}

function localDateIso(input = new Date()) {
  const date = new Date(input);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDaysIso(dateIso, days) {
  const date = new Date(`${dateIso}T00:00:00`);
  date.setDate(date.getDate() + days);
  return localDateIso(date);
}

function ensureBackupsDir() {
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }
}

function getDbSummary(payload) {
  const safe = payload && typeof payload === "object" ? payload : {};
  return {
    clients: Array.isArray(safe.clients) ? safe.clients.length : 0,
    prospects: Array.isArray(safe.prospects) ? safe.prospects.length : 0,
    visits: Array.isArray(safe.visits) ? safe.visits.length : 0,
    products: Array.isArray(safe.products) ? safe.products.length : 0,
    inventory: Array.isArray(safe.inventory) ? safe.inventory.length : 0,
    sellers: Array.isArray(safe.sellers) ? safe.sellers.length : 0
  };
}

function isDangerouslyEmptyImport(summary) {
  return (
    summary.clients === 0 &&
    summary.prospects === 0 &&
    summary.visits === 0 &&
    summary.products === 0 &&
    summary.inventory === 0 &&
    summary.sellers === 0
  );
}

function ensureSystemMutationAllowed(req, res) {
  if (!isProduction) return true;

  if (!allowSystemMutationInProd) {
    res.status(403).json({
      error:
        "Endpoint bloqueado en produccion por seguridad. Configura ALLOW_SYSTEM_MUTATION_IN_PROD=true solo temporalmente."
    });
    return false;
  }

  if (systemMutationToken) {
    const provided =
      String(req.headers["x-system-mutation-token"] || "").trim() ||
      String(req.query.token || "").trim();
    if (!provided || provided !== systemMutationToken) {
      res.status(401).json({ error: "Token de seguridad invalido para mutacion del sistema." });
      return false;
    }
  }

  return true;
}

function makeBackupFileName(prefix = "auto") {
  const stamp = nowIso().replace(/[:.]/g, "-");
  return `db_${prefix}_${stamp}.json`;
}

function writeDbBackup(prefix = "auto") {
  ensureBackupsDir();
  if (!fs.existsSync(dbPath)) return null;
  const fileName = makeBackupFileName(prefix);
  const target = path.join(backupsDir, fileName);
  fs.copyFileSync(dbPath, target);
  return { fileName, path: target };
}

function normalizeSeller(rawSeller = {}) {
  const role = String(rawSeller.role || "seller").trim().toLowerCase();
  return {
    id: String(rawSeller.id || uid("seller")).trim(),
    name: String(rawSeller.name || "").trim(),
    role: role === "owner" ? "owner" : "seller",
    phone: String(rawSeller.phone || "").trim(),
    commissionRate: Math.max(0, parseNumber(rawSeller.commissionRate || 5)),
    weeklyGoal: Math.max(0, parseNumber(rawSeller.weeklyGoal || 0)),
    monthlyGoal: Math.max(0, parseNumber(rawSeller.monthlyGoal || 0)),
    active: rawSeller.active !== false
  };
}

function normalizeProduct(rawProduct = {}) {
  return {
    id: String(rawProduct.id || uid("product")).trim(),
    name: String(rawProduct.name || "").trim(),
    unitPrice: parseNumber(rawProduct.unitPrice),
    ownProduction: rawProduct.ownProduction === true,
    active: rawProduct.active !== false,
    createdAt: String(rawProduct.createdAt || new Date().toISOString())
  };
}

function normalizeInventoryItem(rawItem = {}) {
  return {
    id: String(rawItem.id || uid("inv")).trim(),
    productId: String(rawItem.productId || "").trim(),
    productName: String(rawItem.productName || "").trim(),
    quantity: Math.max(0, parseNumber(rawItem.quantity)),
    updatedAt: String(rawItem.updatedAt || new Date().toISOString())
  };
}

function restoreDispatchStockOnVisitDelete(data, visit) {
  const visitType = String(visit?.visitType || "dispatch").trim().toLowerCase();
  if (visitType === "count_only") return;

  const items = (Array.isArray(visit?.items) ? visit.items : [])
    .map((line) => ({
      productId: String(line?.productId || "").trim(),
      productName: String(line?.productName || "").trim(),
      quantity: Math.max(0, parseNumber(line?.quantity))
    }))
    .filter((line) => line.productName && line.quantity > 0);
  if (!items.length) return;

  const sellerId = String(visit?.createdBySellerId || "").trim();
  if (sellerId) {
    const stocks = Array.isArray(data.sellerStocks) ? data.sellerStocks : [];
    for (const line of items) {
      const byId = line.productId
        ? stocks.find((item) => String(item.sellerId) === sellerId && String(item.productId) === line.productId)
        : null;
      const byName = stocks.find((item) =>
        String(item.sellerId) === sellerId &&
        String(item.productName || "").trim().toLowerCase() === String(line.productName || "").trim().toLowerCase()
      );
      const stock = byId || byName;
      if (stock) {
        stock.quantity = Math.max(0, parseNumber(stock.quantity) + line.quantity);
        stock.updatedAt = nowIso();
      } else {
        stocks.push({
          id: uid("seller_stock"),
          sellerId,
          productId: line.productId,
          productName: line.productName,
          quantity: line.quantity,
          notes: "Restaurado por eliminacion de visita",
          updatedAt: nowIso()
        });
      }
    }
    data.sellerStocks = stocks;
    return;
  }

  const inventory = (Array.isArray(data.inventory) ? data.inventory : []).map(normalizeInventoryItem);
  for (const line of items) {
    const byId = line.productId
      ? inventory.find((item) => String(item.productId) === line.productId)
      : null;
    const byName = inventory.find((item) => String(item.productName || "").trim().toLowerCase() === String(line.productName || "").trim().toLowerCase());
    const stock = byId || byName;
    if (stock) {
      stock.quantity = Math.max(0, parseNumber(stock.quantity) + line.quantity);
      stock.updatedAt = nowIso();
    } else {
      inventory.push(normalizeInventoryItem({
        productId: line.productId,
        productName: line.productName,
        quantity: line.quantity,
        updatedAt: nowIso()
      }));
    }
  }
  data.inventory = inventory;
}

function normalizeProductGoal(rawGoal = {}) {
  return {
    id: String(rawGoal.id || uid("goal")).trim(),
    ownerType: String(rawGoal.ownerType || "owner").trim().toLowerCase() === "seller" ? "seller" : "owner",
    ownerId: String(rawGoal.ownerId || "").trim(),
    productId: String(rawGoal.productId || "").trim(),
    productName: String(rawGoal.productName || "").trim(),
    targetQty: Math.max(0, parseNumber(rawGoal.targetQty)),
    createdAt: String(rawGoal.createdAt || new Date().toISOString())
  };
}

function normalizeRawMaterial(rawMaterial = {}) {
  const appliesToProductIds = Array.isArray(rawMaterial.appliesToProductIds)
    ? rawMaterial.appliesToProductIds
        .map((id) => String(id || "").trim())
        .filter(Boolean)
    : [];
  return {
    id: String(rawMaterial.id || uid("raw")).trim(),
    name: String(rawMaterial.name || "").trim(),
    unit: String(rawMaterial.unit || "kg").trim(),
    stockQty: Math.max(0, parseNumber(rawMaterial.stockQty)),
    costPerUnit: Math.max(0, parseNumber(rawMaterial.costPerUnit)),
    appliesToProductIds,
    lastRestockAt: String(rawMaterial.lastRestockAt || rawMaterial.updatedAt || nowIso()),
    updatedAt: String(rawMaterial.updatedAt || nowIso())
  };
}

function normalizeRawMaterialRestock(rawRestock = {}) {
  return {
    id: String(rawRestock.id || uid("raw_restock")).trim(),
    materialId: String(rawRestock.materialId || "").trim(),
    materialName: String(rawRestock.materialName || "").trim(),
    date: String(rawRestock.date || localDateIso()).trim(),
    qtyAdded: Math.max(0, parseNumber(rawRestock.qtyAdded)),
    unit: String(rawRestock.unit || "").trim(),
    unitCost: Math.max(0, parseNumber(rawRestock.unitCost)),
    totalCost: Math.max(0, parseNumber(rawRestock.totalCost)),
    previousStockQty: Math.max(0, parseNumber(rawRestock.previousStockQty)),
    newStockQty: Math.max(0, parseNumber(rawRestock.newStockQty)),
    previousCostPerUnit: Math.max(0, parseNumber(rawRestock.previousCostPerUnit)),
    newCostPerUnit: Math.max(0, parseNumber(rawRestock.newCostPerUnit)),
    supplier: String(rawRestock.supplier || "").trim(),
    notes: String(rawRestock.notes || "").trim(),
    createdAt: String(rawRestock.createdAt || nowIso())
  };
}

function normalizeProductionRecipe(rawRecipe = {}) {
  const components = Array.isArray(rawRecipe.components)
    ? rawRecipe.components
        .map((component) => ({
          materialId: String(component?.materialId || "").trim(),
          materialName: String(component?.materialName || "").trim(),
          qty: Math.max(0, parseNumber(component?.qty))
        }))
        .filter((component) => component.materialId && component.qty > 0)
    : [];

  return {
    id: String(rawRecipe.id || uid("recipe")).trim(),
    productId: String(rawRecipe.productId || "").trim(),
    productName: String(rawRecipe.productName || "").trim(),
    yieldQty: Math.max(0.0001, parseNumber(rawRecipe.yieldQty || 1)),
    components,
    updatedAt: String(rawRecipe.updatedAt || nowIso())
  };
}

function normalizeProductionBatch(rawBatch = {}) {
  const materialsUsed = Array.isArray(rawBatch.materialsUsed)
    ? rawBatch.materialsUsed.map((row) => ({
        materialId: String(row?.materialId || "").trim(),
        materialName: String(row?.materialName || "").trim(),
        qty: Math.max(0, parseNumber(row?.qty)),
        unit: String(row?.unit || "").trim(),
        costPerUnit: Math.max(0, parseNumber(row?.costPerUnit)),
        totalCost: Math.max(0, parseNumber(row?.totalCost))
      }))
    : [];

  return {
    id: String(rawBatch.id || uid("batch")).trim(),
    date: String(rawBatch.date || localDateIso()).trim(),
    productId: String(rawBatch.productId || "").trim(),
    productName: String(rawBatch.productName || "").trim(),
    outputQty: Math.max(0, parseNumber(rawBatch.outputQty)),
    totalCost: Math.max(0, parseNumber(rawBatch.totalCost)),
    unitCost: Math.max(0, parseNumber(rawBatch.unitCost)),
    notes: String(rawBatch.notes || "").trim(),
    materialsUsed,
    createdAt: String(rawBatch.createdAt || nowIso())
  };
}

function normalizeClient(rawClient = {}) {
  const managedByType = String(rawClient.managedByType || "owner").trim().toLowerCase() === "seller" ? "seller" : "owner";
  return {
    ...rawClient,
    internalId: String(rawClient.internalId || "").trim(),
    tradeName: String(rawClient.tradeName || rawClient.name || "").trim(),
    buyerName: String(rawClient.buyerName || rawClient.contact || "").trim(),
    cep: String(rawClient.cep || "").trim(),
    location: String(rawClient.location || "").trim(),
    addressStreet: String(rawClient.addressStreet || "").trim(),
    addressNumber: String(rawClient.addressNumber || "").trim(),
    addressNeighborhood: String(rawClient.addressNeighborhood || "").trim(),
    addressCity: String(rawClient.addressCity || "").trim(),
    addressState: String(rawClient.addressState || "").trim(),
    type: String(rawClient.type || "bodega").trim(),
    phone: String(rawClient.phone || "").trim(),
    email: String(rawClient.email || "").trim(),
    cpf: String(rawClient.cpf || "").trim(),
    cnpj: String(rawClient.cnpj || "").trim(),
    ie: String(rawClient.ie || "").trim(),
    observations: String(rawClient.observations || "").trim(),
    managedByType,
    managedBySellerId: managedByType === "seller" ? String(rawClient.managedBySellerId || "").trim() : "",
    // Compat fields used by current screens.
    name: String(rawClient.tradeName || rawClient.name || "").trim(),
    contact: String(rawClient.buyerName || rawClient.contact || "").trim()
  };
}

function normalizeProspect(rawProspect = {}) {
  return {
    id: String(rawProspect.id || uid("prospect")).trim(),
    tradeName: String(rawProspect.tradeName || rawProspect.name || "").trim(),
    buyerName: String(rawProspect.buyerName || rawProspect.contact || "").trim(),
    phone: String(rawProspect.phone || "").trim(),
    notes: String(rawProspect.notes || "").trim(),
    convertedClientId: String(rawProspect.convertedClientId || "").trim(),
    convertedAt: String(rawProspect.convertedAt || "").trim(),
    createdAt: String(rawProspect.createdAt || nowIso())
  };
}

function autoConvertProspectsForClient(data, client) {
  const normalizedClient = normalizeClient(client || {});
  const clientTrade = String(normalizedClient.tradeName || normalizedClient.name || "").trim().toLowerCase();
  if (!clientTrade) return;
  const prospects = Array.isArray(data.prospects) ? data.prospects.map(normalizeProspect) : [];
  let changed = false;
  for (const prospect of prospects) {
    if (prospect.convertedClientId) continue;
    const prospectTrade = String(prospect.tradeName || "").trim().toLowerCase();
    if (!prospectTrade) continue;
    if (prospectTrade !== clientTrade) continue;
    prospect.convertedClientId = normalizedClient.id;
    prospect.convertedAt = nowIso();
    changed = true;
  }
  if (changed) data.prospects = prospects;
}

function normalizeClientMovement(rawMovement = {}) {
  const type = String(rawMovement.type || "ajuste").trim().toLowerCase();
  const allowedTypes = new Set(["vencido", "danado", "devolucion", "ajuste", "otro"]);
  const movementType = allowedTypes.has(type) ? type : "ajuste";
  return {
    id: String(rawMovement.id || uid("mov")).trim(),
    clientId: String(rawMovement.clientId || "").trim(),
    date: String(rawMovement.date || localDateIso()).trim(),
    type: movementType,
    productId: String(rawMovement.productId || "").trim(),
    productName: String(rawMovement.productName || "").trim(),
    quantity: Math.max(0, parseNumber(rawMovement.quantity)),
    notes: String(rawMovement.notes || "").trim(),
    createdBySellerId: String(rawMovement.createdBySellerId || "").trim(),
    createdAt: String(rawMovement.createdAt || nowIso())
  };
}

function hasDuplicateClient(clients, candidate, options = {}) {
  const excludeId = String(options.excludeId || "").trim();
  const scopeSellerId = String(options.scopeSellerId || "").trim();
  const candTradeName = String(candidate.tradeName || "").trim().toLowerCase();
  const candBuyerName = String(candidate.buyerName || "").trim().toLowerCase();
  const candCpf = cleanDigits(candidate.cpf || "");
  const candCnpj = cleanDigits(candidate.cnpj || "");

  return (clients || []).some((raw) => {
    const current = normalizeClient(raw || {});
    if (excludeId && String(current.id) === excludeId) return false;
    if (scopeSellerId && String(current.managedBySellerId || "") !== scopeSellerId) return false;

    const currentCpf = cleanDigits(current.cpf || "");
    const currentCnpj = cleanDigits(current.cnpj || "");
    if (candCpf && currentCpf && candCpf === currentCpf) return true;
    if (candCnpj && currentCnpj && candCnpj === currentCnpj) return true;

    const currentTradeName = String(current.tradeName || current.name || "").trim().toLowerCase();
    const currentBuyerName = String(current.buyerName || current.contact || "").trim().toLowerCase();
    if (candTradeName && candBuyerName && candTradeName === currentTradeName && candBuyerName === currentBuyerName) return true;
    return false;
  });
}

async function fetchJson(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const response = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
  clearTimeout(timer);
  if (!response.ok) {
    throw new Error(`Error HTTP ${response.status} consultando ${url}`);
  }
  return response.json();
}

function getNextInternalId(clients) {
  let max = 0;
  for (const client of clients) {
    const current = String(client.internalId || "").toUpperCase();
    const match = current.match(/^CLI-(\d+)$/);
    if (!match) continue;
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > max) {
      max = value;
    }
  }
  return `CLI-${String(max + 1).padStart(4, "0")}`;
}

function ensureDefaultSellers(data) {
  const sellers = (data.sellers || []).map(normalizeSeller);
  let changed = false;

  if (!sellers.some((seller) => seller.role === "owner")) {
    sellers.unshift(normalizeSeller({ id: "seller_owner", name: "Propietario", role: "owner", active: true }));
    changed = true;
  }

  if (!sellers.some((seller) => seller.role === "seller")) {
    sellers.push(normalizeSeller({ id: "seller_ext_01", name: "Edwin", role: "seller", active: true }));
    changed = true;
  }

  // Keep default seller name aligned with current business.
  const idx = sellers.findIndex((seller) => seller.id === "seller_ext_01");
  if (idx >= 0 && String(sellers[idx].name || "").trim().toLowerCase() === "vendedor externo") {
    sellers[idx] = { ...sellers[idx], name: "Edwin" };
    changed = true;
  }

  return { sellers, changed };
}

function isThisWeek(dateString) {
  const date = new Date(`${dateString}T00:00:00`);
  const now = new Date();

  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const day = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - day);

  const end = new Date(start);
  end.setDate(end.getDate() + 7);

  return date >= start && date < end;
}

function computeWeeklyProductSales(visits, allowedClientIds = null) {
  const byProduct = new Map();
  for (const visit of visits) {
    if (!isThisWeek(visit.date)) continue;
    if (allowedClientIds && !allowedClientIds.has(String(visit.clientId))) continue;
    const items = Array.isArray(visit.items) ? visit.items : [];
    for (const item of items) {
      const productId = String(item.productId || "").trim();
      const productName = String(item.productName || "").trim();
      if (!productName) continue;
      const key = productId || productName.toLowerCase();
      const current = byProduct.get(key) || { productId, productName, soldQty: 0 };
      current.soldQty += Math.max(0, parseNumber(item.quantity));
      byProduct.set(key, current);
    }
  }
  return [...byProduct.values()].sort((a, b) => b.soldQty - a.soldQty);
}

function computeDailyClosure(data, dateIso) {
  const dayVisits = (Array.isArray(data.visits) ? data.visits : []).filter((visit) => String(visit.date) === String(dateIso));
  const totalSold = dayVisits.reduce((acc, visit) => acc + parseNumber(visit.totalValue ?? visit.soldAmount), 0);
  const totalCollected = dayVisits.reduce((acc, visit) => acc + parseNumber(visit.amountCollected), 0);
  const totalPending = dayVisits.reduce((acc, visit) => {
    const visitValue = parseNumber(visit.totalValue ?? visit.soldAmount);
    const pending = Math.max(0, visitValue - parseNumber(visit.amountCollected));
    return acc + pending;
  }, 0);
  const uniqueClients = new Set(dayVisits.map((visit) => String(visit.clientId || "")));

  return {
    id: uid("daily_close"),
    date: String(dateIso),
    visitsCount: dayVisits.length,
    clientsVisited: [...uniqueClients].filter(Boolean).length,
    totalSold,
    totalCollected,
    totalPending,
    createdAt: nowIso(),
    source: "auto"
  };
}

function ensureDailyClosures(data) {
  const closures = Array.isArray(data.dailyClosures) ? data.dailyClosures : [];
  const closedDates = new Set(closures.map((item) => String(item.date || "")));
  const existingVisitDates = [...new Set((Array.isArray(data.visits) ? data.visits : []).map((visit) => String(visit.date || "")).filter(Boolean))].sort();

  const yesterday = addDaysIso(localDateIso(), -1);
  if (existingVisitDates.length === 0) {
    data.dailyClosures = closures;
    return false;
  }

  let changed = false;
  const firstDate = existingVisitDates[0];
  const startDate =
    closures.length > 0
      ? addDaysIso(
          closures
            .map((item) => String(item.date || ""))
            .filter(Boolean)
            .sort()
            .slice(-1)[0],
          1
        )
      : firstDate;

  let cursor = startDate;
  while (cursor <= yesterday) {
    if (!closedDates.has(cursor)) {
      closures.push(computeDailyClosure(data, cursor));
      closedDates.add(cursor);
      changed = true;
    }
    cursor = addDaysIso(cursor, 1);
  }

  data.dailyClosures = closures.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return changed;
}

function readDb() {
  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify({ clients: [], prospects: [], visits: [], sellers: [], sellerUsers: [], sellerSessions: [], appointments: [], products: [], sellerStocks: [], inventory: [], productGoals: [], clientMovements: [], dailyClosures: [], rawMaterials: [], rawMaterialRestocks: [], productionRecipes: [], productionBatches: [], settings: { ownerWeeklyGoal: 0, lastAutoBackupDate: "" } }, null, 2));
  }

  const raw = fs.readFileSync(dbPath, "utf-8");
  const parsed = JSON.parse(raw);

  return {
    clients: Array.isArray(parsed.clients) ? parsed.clients : [],
    prospects: Array.isArray(parsed.prospects) ? parsed.prospects.map(normalizeProspect) : [],
    visits: Array.isArray(parsed.visits) ? parsed.visits : [],
    sellers: Array.isArray(parsed.sellers) ? parsed.sellers : [],
    sellerUsers: Array.isArray(parsed.sellerUsers) ? parsed.sellerUsers : [],
    sellerSessions: Array.isArray(parsed.sellerSessions) ? parsed.sellerSessions : [],
    appointments: Array.isArray(parsed.appointments) ? parsed.appointments : [],
    products: Array.isArray(parsed.products) ? parsed.products : [],
    sellerStocks: Array.isArray(parsed.sellerStocks) ? parsed.sellerStocks : [],
    inventory: Array.isArray(parsed.inventory) ? parsed.inventory : [],
    productGoals: Array.isArray(parsed.productGoals) ? parsed.productGoals : [],
    clientMovements: Array.isArray(parsed.clientMovements) ? parsed.clientMovements.map(normalizeClientMovement) : [],
    dailyClosures: Array.isArray(parsed.dailyClosures) ? parsed.dailyClosures : [],
    rawMaterials: Array.isArray(parsed.rawMaterials) ? parsed.rawMaterials.map(normalizeRawMaterial) : [],
    rawMaterialRestocks: Array.isArray(parsed.rawMaterialRestocks) ? parsed.rawMaterialRestocks.map(normalizeRawMaterialRestock) : [],
    productionRecipes: Array.isArray(parsed.productionRecipes) ? parsed.productionRecipes.map(normalizeProductionRecipe) : [],
    productionBatches: Array.isArray(parsed.productionBatches) ? parsed.productionBatches.map(normalizeProductionBatch) : [],
    settings:
      typeof parsed.settings === "object" && parsed.settings
        ? parsed.settings
        : { ownerWeeklyGoal: 0, lastAutoBackupDate: "" }
  };
}

function writeDb(data) {
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), "utf-8");
}

function getClientVisits(visits, clientId) {
  return visits
    .filter((visit) => visit.clientId === clientId)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

function calculateSold(clientVisits, currentRemaining, currentDelivered) {
  if (clientVisits.length === 0) {
    return Math.max(0, currentDelivered - currentRemaining);
  }

  const previousVisit = clientVisits[clientVisits.length - 1];
  return Math.max(0, parseNumber(previousVisit.delivered) - currentRemaining);
}

function getClientDebt(visits, clientId) {
  return visits
    .filter((visit) => visit.clientId === clientId)
    .reduce((acc, visit) => {
      const saleType = String(visit.saleType || "");
      const isCredit = visit.paymentType === "consignado" || saleType === "consignado" || saleType === "boleto";
      if (!isCredit) return acc;
      const visitValue = parseNumber(visit.totalValue ?? visit.soldAmount);
      return acc + Math.max(0, visitValue - parseNumber(visit.amountCollected));
    }, 0);
}

function getLastVisit(visits, clientId) {
  const clientVisits = getClientVisits(visits, clientId);
  return clientVisits.length ? clientVisits[clientVisits.length - 1] : null;
}

function computeClientProductAvailability(visits, clientId) {
  const timeline = getClientVisits(visits || [], clientId);
  const byProduct = new Map();

  for (const visit of timeline) {
    const visitType = String(visit.visitType || "dispatch").trim().toLowerCase();
    const items = Array.isArray(visit.items) ? visit.items : [];

    for (const item of items) {
      const productName = String(item.productName || "").trim();
      if (!productName) continue;
      const productId = String(item.productId || "").trim();
      const key = productId || productName.toLowerCase();
      const current = byProduct.get(key) || {
        productId,
        productName,
        availableQty: 0,
        lastUpdated: "",
        source: "estimado"
      };

      const hasRemaining = item.remaining !== null && item.remaining !== undefined && String(item.remaining).trim() !== "";
      if (visitType === "count_only") {
        if (hasRemaining) {
          current.availableQty = Math.max(0, parseNumber(item.remaining));
          current.source = "conteo";
          current.lastUpdated = String(visit.date || current.lastUpdated || "");
        }
      } else if (hasRemaining) {
        current.availableQty = Math.max(0, parseNumber(item.remaining));
        current.source = "conteo";
        current.lastUpdated = String(visit.date || current.lastUpdated || "");
      } else {
        // If there is no count, keep estimate using the latest dispatch quantity.
        current.availableQty = Math.max(0, parseNumber(item.quantity));
        if (current.source !== "conteo") current.source = "estimado";
        current.lastUpdated = String(visit.date || current.lastUpdated || "");
      }

      byProduct.set(key, current);
    }
  }

  return [...byProduct.values()]
    .sort((a, b) => String(a.productName).localeCompare(String(b.productName), "es", { sensitivity: "base" }));
}

function escapeCsv(value) {
  const text = String(value ?? "");
  if (/[;"\n\r]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

function getSuggestedDelivery(visits, clientId) {
  const clientVisits = getClientVisits(visits, clientId);
  if (clientVisits.length === 0) return DEFAULT_SUGGESTION_MIN;

  const recent = clientVisits.slice(-3);
  const avg = recent.reduce((acc, visit) => acc + parseNumber(visit.soldUnits ?? visit.soldAmount), 0) / recent.length;

  const result = Math.ceil(avg * 1.15);
  return Math.max(DEFAULT_SUGGESTION_MIN, result || DEFAULT_SUGGESTION_MIN);
}

function computeDashboard(data) {
  const totalSoldThisWeek = data.visits
    .filter((visit) => isThisWeek(visit.date))
    .reduce((acc, visit) => acc + parseNumber(visit.totalValue ?? visit.soldAmount), 0);

  const totalDebt = data.clients.reduce((acc, client) => acc + getClientDebt(data.visits, client.id), 0);

  const clientsNeedingVisit = data.clients
    .filter((client) => {
      const lastVisit = getLastVisit(data.visits, client.id);
      if (!lastVisit) return true;

      if (lastVisit.nextVisitDate) {
        return new Date(`${lastVisit.nextVisitDate}T00:00:00`) <= new Date();
      }

      const daysSinceLast = (Date.now() - new Date(`${lastVisit.date}T00:00:00`).getTime()) / (1000 * 60 * 60 * 24);
      return daysSinceLast >= 7;
    })
    .map((client) => ({
      id: client.id,
      name: client.name,
      location: client.location || "",
      lastVisitDate: getLastVisit(data.visits, client.id)?.date || ""
    }));

  const topClients = data.clients
    .map((client) => {
      const totalSold = data.visits
        .filter((visit) => visit.clientId === client.id)
        .reduce((acc, visit) => acc + parseNumber(visit.totalValue ?? visit.soldAmount), 0);

      return {
        id: client.id,
        name: client.name,
        totalSold
      };
    })
    .sort((a, b) => b.totalSold - a.totalSold)
    .slice(0, 5);

  const ownerWeeklyGoal = Math.max(0, parseNumber(data.settings?.ownerWeeklyGoal));
  const ownerWeeklyRemaining = Math.max(0, ownerWeeklyGoal - totalSoldThisWeek);
  const ownerWeeklyProgressPct = ownerWeeklyGoal > 0 ? Math.min(100, (totalSoldThisWeek / ownerWeeklyGoal) * 100) : 0;

  return {
    totalSoldThisWeek,
    totalDebt,
    clientsNeedingVisit,
    topClients,
    ownerWeeklyGoal,
    ownerWeeklyRemaining,
    ownerWeeklyProgressPct
  };
}

function isThisMonth(dateString) {
  const d = new Date(`${dateString}T00:00:00`);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

function inNextDays(dateString, days) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + days);
  const d = new Date(`${dateString}T00:00:00`);
  return d >= start && d <= end;
}

function getCollectionMethod(visit) {
  const value = String(visit.collectionMethod || "").trim().toLowerCase();
  if (value) return value;
  if (String(visit.saleType || "") === "boleto") return "boleto";
  if (String(visit.saleType || "") === "a_vista") return "efectivo";
  return "pendiente";
}

function computeSellersOverview(data, sellers) {
  const clients = data.clients.map(normalizeClient);
  const clientMap = new Map(clients.map((client) => [client.id, client]));
  const stocks = Array.isArray(data.sellerStocks) ? data.sellerStocks : [];

  return sellers
    .filter((seller) => seller.role === "seller")
    .map((seller) => {
      const assignedClients = clients.filter((client) => client.managedByType === "seller" && client.managedBySellerId === seller.id);
      const clientIds = new Set(assignedClients.map((client) => client.id));
      const sellerVisits = data.visits
        .filter((visit) => clientIds.has(visit.clientId) || String(visit.createdBySellerId || "") === seller.id)
        .map((visit) => ({
          ...visit,
          clientName: clientMap.get(visit.clientId)?.tradeName || clientMap.get(visit.clientId)?.name || visit.prospectTradeName || "Cliente",
          clientInternalId: clientMap.get(visit.clientId)?.internalId || ""
        }));
      const weekSales = sellerVisits
        .filter((visit) => isThisWeek(visit.date))
        .reduce((acc, visit) => acc + parseNumber(visit.totalValue ?? visit.soldAmount), 0);
      const monthSales = sellerVisits
        .filter((visit) => isThisMonth(visit.date))
        .reduce((acc, visit) => acc + parseNumber(visit.totalValue ?? visit.soldAmount), 0);

      const totalDebt = assignedClients.reduce((acc, client) => acc + getClientDebt(data.visits, client.id), 0);
      const paymentsByMethod = sellerVisits.reduce((acc, visit) => {
        const collected = parseNumber(visit.amountCollected);
        if (collected <= 0) return acc;
        const method = getCollectionMethod(visit);
        acc[method] = (acc[method] || 0) + collected;
        return acc;
      }, {});

      const scheduleWeek = data.appointments
        .filter((appt) => appt.status !== "done" && clientIds.has(appt.clientId))
        .sort((a, b) => new Date(a.date) - new Date(b.date))
        .map((appt) => ({
          ...appt,
          clientName: clientMap.get(appt.clientId)?.tradeName || clientMap.get(appt.clientId)?.name || "Cliente",
          clientInternalId: clientMap.get(appt.clientId)?.internalId || ""
        }));

      const visitHistory = sellerVisits
        .slice()
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 80);

      const sellerStock = stocks
        .filter((stock) => stock.sellerId === seller.id)
        .map((stock) => ({
          ...stock,
          quantity: parseNumber(stock.quantity),
          updatedAt: String(stock.updatedAt || "")
        }));
      const stockUnits = sellerStock.reduce((acc, item) => acc + parseNumber(item.quantity), 0);
      const commissionAmount = monthSales * (parseNumber(seller.commissionRate) / 100);
      const weekGoalRemaining = Math.max(0, parseNumber(seller.weeklyGoal) - weekSales);
      const weekGoalProgressPct = parseNumber(seller.weeklyGoal) > 0 ? Math.min(100, (weekSales / parseNumber(seller.weeklyGoal)) * 100) : 0;

      return {
        sellerId: seller.id,
        sellerName: seller.name,
        commissionRate: parseNumber(seller.commissionRate),
        weeklyGoal: parseNumber(seller.weeklyGoal),
        monthlyGoal: parseNumber(seller.monthlyGoal),
        assignedClients: assignedClients.map((client) => ({
          id: client.id,
          internalId: client.internalId || "",
          tradeName: client.tradeName || client.name || "Cliente",
          buyerName: client.buyerName || client.contact || "",
          debt: getClientDebt(data.visits, client.id),
          productAvailability: computeClientProductAvailability(data.visits, client.id)
        })),
        totalClients: assignedClients.length,
        totalDebt,
        weekSales,
        weekGoalRemaining,
        weekGoalProgressPct,
        monthSales,
        commissionAmount,
        paymentsByMethod,
        scheduleWeek,
        visitHistory,
        stock: sellerStock,
        stockUnits
      };
    });
}

function computeProductGoalProgress(data, ownerType, ownerId = "") {
  const goals = (Array.isArray(data.productGoals) ? data.productGoals : [])
    .map(normalizeProductGoal)
    .filter((goal) => goal.ownerType === ownerType && String(goal.ownerId || "") === String(ownerId || ""));

  if (goals.length === 0) return [];

  let allowedClientIds = null;
  if (ownerType === "seller") {
    const clients = data.clients.map(normalizeClient);
    allowedClientIds = new Set(
      clients
        .filter((client) => client.managedByType === "seller" && client.managedBySellerId === ownerId)
        .map((client) => client.id)
    );
  }

  const weeklySales = computeWeeklyProductSales(data.visits || [], allowedClientIds);
  const weeklySalesMap = new Map(
    weeklySales.map((row) => [row.productId || row.productName.toLowerCase(), row.soldQty])
  );

  return goals.map((goal) => {
    const key = goal.productId || goal.productName.toLowerCase();
    const soldQty = Math.max(0, parseNumber(weeklySalesMap.get(key)));
    const remainingQty = Math.max(0, goal.targetQty - soldQty);
    const progressPct = goal.targetQty > 0 ? Math.min(100, (soldQty / goal.targetQty) * 100) : 0;
    return {
      ...goal,
      soldQty,
      remainingQty,
      progressPct
    };
  });
}

function findInventoryItemByProduct(inventory, productId, productName) {
  const normalizedName = String(productName || "").trim().toLowerCase();
  const byId = productId ? inventory.find((item) => String(item.productId) === String(productId)) : null;
  const byName = normalizedName
    ? inventory.find((item) => String(item.productName || "").trim().toLowerCase() === normalizedName)
    : null;
  return byId || byName || null;
}

function computeProductionSummary(data) {
  const inventory = (Array.isArray(data.inventory) ? data.inventory : []).map(normalizeInventoryItem);
  const rawMaterials = (Array.isArray(data.rawMaterials) ? data.rawMaterials : []).map(normalizeRawMaterial);
  const recipes = (Array.isArray(data.productionRecipes) ? data.productionRecipes : []).map(normalizeProductionRecipe);
  const batches = (Array.isArray(data.productionBatches) ? data.productionBatches : []).map(normalizeProductionBatch);
  const weeklyDemand = computeWeeklyProductSales(data.visits || []);
  const recipeMap = new Map(
    recipes.map((recipe) => [recipe.productId || String(recipe.productName || "").toLowerCase(), recipe])
  );
  const materialStockMap = new Map(rawMaterials.map((material) => [material.id, material]));
  const requiredMaterialMap = new Map();

  const byProduct = weeklyDemand.map((row) => {
    const stockItem = findInventoryItemByProduct(inventory, row.productId, row.productName);
    const currentStock = stockItem ? parseNumber(stockItem.quantity) : 0;
    const suggestedProduction = Math.max(0, Math.ceil(Math.max(0, row.soldQty - currentStock)));
    const recipeKey = row.productId || String(row.productName || "").toLowerCase();
    const recipe = recipeMap.get(recipeKey) || null;
    if (recipe && suggestedProduction > 0) {
      const factor = suggestedProduction / Math.max(0.0001, parseNumber(recipe.yieldQty));
      for (const component of recipe.components) {
        const current = requiredMaterialMap.get(component.materialId) || {
          materialId: component.materialId,
          materialName: component.materialName,
          requiredQty: 0
        };
        current.requiredQty += parseNumber(component.qty) * factor;
        requiredMaterialMap.set(component.materialId, current);
      }
    }
    return {
      productId: row.productId,
      productName: row.productName,
      weekDemandQty: row.soldQty,
      currentStock,
      suggestedProduction,
      hasRecipe: !!recipe
    };
  });

  const requiredMaterials = [...requiredMaterialMap.values()]
    .map((required) => {
      const stock = materialStockMap.get(required.materialId);
      const currentStock = stock ? parseNumber(stock.stockQty) : 0;
      const toBuyQty = Math.max(0, required.requiredQty - currentStock);
      return {
        ...required,
        unit: stock?.unit || "",
        currentStock,
        toBuyQty,
        costPerUnit: stock ? parseNumber(stock.costPerUnit) : 0,
        estimatedBuyCost: toBuyQty * (stock ? parseNumber(stock.costPerUnit) : 0)
      };
    })
    .sort((a, b) => b.toBuyQty - a.toBuyQty);

  const byProductCostMap = new Map();
  for (const batch of batches) {
    const key = batch.productId || String(batch.productName || "").toLowerCase();
    const current = byProductCostMap.get(key) || {
      productId: batch.productId,
      productName: batch.productName,
      totalOutput: 0,
      totalCost: 0
    };
    current.totalOutput += parseNumber(batch.outputQty);
    current.totalCost += parseNumber(batch.totalCost);
    byProductCostMap.set(key, current);
  }
  const averageUnitCostByProduct = [...byProductCostMap.values()]
    .map((row) => ({
      ...row,
      avgUnitCost: row.totalOutput > 0 ? row.totalCost / row.totalOutput : 0
    }))
    .sort((a, b) => b.totalOutput - a.totalOutput);

  return {
    byProduct,
    requiredMaterials,
    averageUnitCostByProduct,
    totalEstimatedBuyCost: requiredMaterials.reduce((acc, row) => acc + parseNumber(row.estimatedBuyCost), 0)
  };
}

function parseBearerToken(headerValue = "") {
  const raw = String(headerValue || "");
  if (!raw.toLowerCase().startsWith("bearer ")) return "";
  return raw.slice(7).trim();
}

function cleanExpiredSessions(data) {
  const now = Date.now();
  const sessions = Array.isArray(data.sellerSessions) ? data.sellerSessions : [];
  data.sellerSessions = sessions.filter((session) => {
    const exp = new Date(String(session.expiresAt || "")).getTime();
    return Number.isFinite(exp) && exp > now;
  });
}

function getSellerAuthContext(data, req) {
  const token = parseBearerToken(req.headers?.authorization || "");
  if (!token) return null;
  cleanExpiredSessions(data);
  const sessions = Array.isArray(data.sellerSessions) ? data.sellerSessions : [];
  const session = sessions.find((item) => String(item.token) === token);
  if (!session) return null;
  const users = (Array.isArray(data.sellerUsers) ? data.sellerUsers : []).map(normalizeSellerUser);
  const user = users.find((item) => item.id === session.sellerUserId && item.active);
  if (!user) return null;
  const sellers = (Array.isArray(data.sellers) ? data.sellers : []).map(normalizeSeller);
  const seller = sellers.find((item) => item.id === user.sellerId && item.active);
  if (!seller || seller.role !== "seller") return null;
  return { token, session, user, seller };
}

function buildSellerAppData(data, sellerId) {
  const sellers = (Array.isArray(data.sellers) ? data.sellers : []).map(normalizeSeller);
  const overview = computeSellersOverview(data, sellers).find((item) => item.sellerId === sellerId);
  if (!overview) return null;
  const assignedClientIds = new Set((overview.assignedClients || []).map((client) => String(client.id)));
  return {
    seller: {
      id: overview.sellerId,
      name: overview.sellerName,
      commissionRate: overview.commissionRate,
      weeklyGoal: overview.weeklyGoal,
      monthlyGoal: overview.monthlyGoal
    },
    summary: {
      totalClients: overview.totalClients,
      totalDebt: overview.totalDebt,
      weekSales: overview.weekSales,
      weekGoalRemaining: overview.weekGoalRemaining,
      weekGoalProgressPct: overview.weekGoalProgressPct,
      monthSales: overview.monthSales,
      commissionAmount: overview.commissionAmount,
      stockUnits: overview.stockUnits
    },
    paymentsByMethod: overview.paymentsByMethod,
    clients: overview.assignedClients,
    agendaWeek: overview.scheduleWeek,
    visitsHistory: overview.visitHistory,
    stock: overview.stock,
    products: (data.products || []).map(normalizeProduct).filter((p) => p.active !== false),
    clientMovements: (data.clientMovements || [])
      .map(normalizeClientMovement)
      .filter((movement) => assignedClientIds.has(String(movement.clientId)))
      .sort((a, b) => new Date(`${b.date}T00:00:00`) - new Date(`${a.date}T00:00:00`)),
    productGoals: (data.productGoals || [])
      .map(normalizeProductGoal)
      .filter((goal) => goal.ownerType === "seller" && goal.ownerId === sellerId),
    productGoalProgress: computeProductGoalProgress(data, "seller", sellerId)
  };
}

function runAutomaticMaintenance(source = "startup") {
  const data = readDb();
  let changed = false;

  const closuresChanged = ensureDailyClosures(data);
  if (closuresChanged) changed = true;

  const today = localDateIso();
  const settings = typeof data.settings === "object" && data.settings ? data.settings : { ownerWeeklyGoal: 0, lastAutoBackupDate: "" };
  const lastAutoBackupDate = String(settings.lastAutoBackupDate || "");
  if (lastAutoBackupDate !== today) {
    const backup = writeDbBackup("auto");
    if (backup) {
      data.settings = { ...settings, lastAutoBackupDate: today };
      changed = true;
    }
  } else {
    data.settings = settings;
  }

  if (changed) writeDb(data);
  return { changed, source };
}

function scheduleNightlyMaintenance() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 5, 0);
  const timeoutMs = Math.max(1000, next.getTime() - now.getTime());

  setTimeout(() => {
    try {
      runAutomaticMaintenance("nightly");
      console.log(`[auto] cierre diario + backup ejecutado (${localDateIso()})`);
    } catch (error) {
      console.error(`[auto] error en mantenimiento nocturno: ${error.message}`);
    } finally {
      scheduleNightlyMaintenance();
    }
  }, timeoutMs);
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/system/backups", (_req, res) => {
  ensureBackupsDir();
  const files = fs
    .readdirSync(backupsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
    .map((entry) => {
      const full = path.join(backupsDir, entry.name);
      const stat = fs.statSync(full);
      return {
        fileName: entry.name,
        sizeBytes: stat.size,
        updatedAt: stat.mtime.toISOString()
      };
    })
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  return res.json({ backupsDir, files });
});

app.post("/api/system/backup", (_req, res) => {
  const result = writeDbBackup("manual");
  if (!result) return res.status(500).json({ error: "No fue posible crear backup." });
  return res.status(201).json({ ok: true, ...result });
});

app.get("/api/system/db-export", (_req, res) => {
  const data = readDb();
  return res.status(200).json(data);
});

app.post("/api/system/db-import", (req, res) => {
  if (!ensureSystemMutationAllowed(req, res)) return;

  const payload = req.body;
  if (!payload || typeof payload !== "object") {
    return res.status(400).json({ error: "JSON de base de datos invalido." });
  }

  const normalized = {
    clients: Array.isArray(payload.clients) ? payload.clients : [],
    prospects: Array.isArray(payload.prospects) ? payload.prospects : [],
    visits: Array.isArray(payload.visits) ? payload.visits : [],
    sellers: Array.isArray(payload.sellers) ? payload.sellers : [],
    sellerUsers: Array.isArray(payload.sellerUsers) ? payload.sellerUsers : [],
    sellerSessions: Array.isArray(payload.sellerSessions) ? payload.sellerSessions : [],
    appointments: Array.isArray(payload.appointments) ? payload.appointments : [],
    products: Array.isArray(payload.products) ? payload.products : [],
    sellerStocks: Array.isArray(payload.sellerStocks) ? payload.sellerStocks : [],
    inventory: Array.isArray(payload.inventory) ? payload.inventory : [],
    productGoals: Array.isArray(payload.productGoals) ? payload.productGoals : [],
    clientMovements: Array.isArray(payload.clientMovements) ? payload.clientMovements : [],
    dailyClosures: Array.isArray(payload.dailyClosures) ? payload.dailyClosures : [],
    rawMaterials: Array.isArray(payload.rawMaterials) ? payload.rawMaterials : [],
    rawMaterialRestocks: Array.isArray(payload.rawMaterialRestocks) ? payload.rawMaterialRestocks : [],
    productionRecipes: Array.isArray(payload.productionRecipes) ? payload.productionRecipes : [],
    productionBatches: Array.isArray(payload.productionBatches) ? payload.productionBatches : [],
    settings: typeof payload.settings === "object" && payload.settings ? payload.settings : { ownerWeeklyGoal: 0, lastAutoBackupDate: "" }
  };

  const summary = getDbSummary(normalized);
  const forceEmpty = payload.forceEmpty === true || String(req.query.forceEmpty || "").toLowerCase() === "true";
  if (isDangerouslyEmptyImport(summary) && !forceEmpty) {
    return res.status(400).json({
      error:
        "Import bloqueado: el JSON esta vacio. Usa forceEmpty=true solo si realmente deseas borrar todo."
    });
  }

  writeDbBackup("pre_import");
  writeDb(normalized);
  return res.status(200).json({
    ok: true,
    summary
  });
});

app.post("/api/system/restore-backup/:fileName", (req, res) => {
  if (!ensureSystemMutationAllowed(req, res)) return;

  const fileName = String(req.params.fileName || "").trim();
  if (!fileName || fileName.includes("..") || fileName.includes("/") || fileName.includes("\\")) {
    return res.status(400).json({ error: "Nombre de archivo invalido." });
  }
  if (!fileName.toLowerCase().endsWith(".json")) {
    return res.status(400).json({ error: "El backup debe ser .json." });
  }

  ensureBackupsDir();
  const backupFile = path.join(backupsDir, fileName);
  if (!fs.existsSync(backupFile)) {
    return res.status(404).json({ error: "Backup no encontrado." });
  }

  try {
    const payload = JSON.parse(fs.readFileSync(backupFile, "utf-8"));
    if (!payload || typeof payload !== "object") {
      return res.status(400).json({ error: "Contenido del backup invalido." });
    }
    const summary = getDbSummary(payload);
    const forceEmpty = req.body?.forceEmpty === true || String(req.query.forceEmpty || "").toLowerCase() === "true";
    if (isDangerouslyEmptyImport(summary) && !forceEmpty) {
      return res.status(400).json({
        error:
          "Restore bloqueado: backup vacio. Usa forceEmpty=true solo si deseas limpiar toda la base."
      });
    }
    writeDbBackup("pre_restore");
    writeDb(payload);
    return res.status(200).json({ ok: true, restoredFrom: fileName, summary });
  } catch (error) {
    return res.status(500).json({ error: `No fue posible restaurar backup: ${error.message}` });
  }
});

app.get("/api/data", (_req, res) => {
  const data = readDb();
  const { sellers, changed } = ensureDefaultSellers(data);
  const usersState = ensureDefaultSellerUsers(data, sellers);
  cleanExpiredSessions(data);
  if (changed || usersState.changed) {
    data.sellers = sellers;
    data.sellerUsers = usersState.users;
    writeDb(data);
  }
  const sellerMap = new Map(sellers.map((seller) => [seller.id, seller]));

  const clients = data.clients.map((client) => {
    const normalized = normalizeClient(client);
    return {
      ...normalized,
      managedByName:
        normalized.managedByType === "seller"
          ? sellerMap.get(normalized.managedBySellerId)?.name || "Vendedor externo"
          : "Propietario",
      debt: getClientDebt(data.visits, client.id),
      lastVisit: getLastVisit(data.visits, client.id),
      suggestedDelivery: getSuggestedDelivery(data.visits, client.id),
      productAvailability: computeClientProductAvailability(data.visits, client.id)
    };
  });

  res.json({
    clients,
    prospects: (data.prospects || []).map(normalizeProspect),
    visits: (data.visits || []).map((visit) => ({
      ...visit,
      createdBySellerName: String(visit?.createdBySellerId || "").trim()
        ? sellerMap.get(String(visit.createdBySellerId))?.name || "Vendedor"
        : "Admin"
    })),
    sellers,
    appointments: data.appointments,
    products: data.products.map(normalizeProduct),
    inventory: (data.inventory || []).map(normalizeInventoryItem),
    rawMaterials: (data.rawMaterials || []).map(normalizeRawMaterial),
    rawMaterialRestocks: (data.rawMaterialRestocks || []).map(normalizeRawMaterialRestock).sort((a, b) => new Date(`${b.date}T00:00:00`) - new Date(`${a.date}T00:00:00`)),
    productionRecipes: (data.productionRecipes || []).map(normalizeProductionRecipe),
    productionBatches: (data.productionBatches || []).map(normalizeProductionBatch).sort((a, b) => new Date(b.date) - new Date(a.date)),
    productionSummary: computeProductionSummary(data),
    productGoals: (data.productGoals || []).map(normalizeProductGoal),
    clientMovements: (data.clientMovements || []).map(normalizeClientMovement),
    ownerProductGoalProgress: computeProductGoalProgress(data, "owner", ""),
    dailyClosures: (data.dailyClosures || []).slice(-30),
    sellerUsers: (data.sellerUsers || []).map(normalizeSellerUser).map((user) => ({ id: user.id, sellerId: user.sellerId, username: user.username, active: user.active })),
    sellerOverview: computeSellersOverview(data, sellers),
    settings: { ownerWeeklyGoal: Math.max(0, parseNumber(data.settings?.ownerWeeklyGoal)) },
    dashboard: computeDashboard(data)
  });
});

app.post("/api/settings/owner-goal", (req, res) => {
  const data = readDb();
  data.settings = {
    ...(typeof data.settings === "object" && data.settings ? data.settings : {}),
    ownerWeeklyGoal: Math.max(0, parseNumber(req.body?.ownerWeeklyGoal))
  };
  writeDb(data);
  return res.status(200).json({ ownerWeeklyGoal: data.settings.ownerWeeklyGoal });
});

app.get("/api/products", (_req, res) => {
  const data = readDb();
  return res.json({ products: data.products.map(normalizeProduct) });
});

app.post("/api/products", (req, res) => {
  const body = req.body || {};
  const data = readDb();
  const product = normalizeProduct({
    id: uid("product"),
    name: body.name,
    unitPrice: body.unitPrice,
    ownProduction: body.ownProduction === true,
    active: body.active !== false
  });

  if (!product.name) {
    return res.status(400).json({ error: "El nombre del producto es obligatorio." });
  }
  if (data.products.some((p) => String(p.name || "").trim().toLowerCase() === product.name.toLowerCase())) {
    return res.status(409).json({ error: "Ya existe un producto con ese nombre." });
  }

  data.products.unshift(product);
  writeDb(data);
  return res.status(201).json(product);
});

app.put("/api/products/:id", (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ error: "ID invalido." });

  const data = readDb();
  const products = (data.products || []).map(normalizeProduct);
  const product = products.find((row) => row.id === id);
  if (!product) return res.status(404).json({ error: "Producto no encontrado." });

  if (req.body?.name !== undefined) {
    const nextName = String(req.body?.name || "").trim();
    if (!nextName) return res.status(400).json({ error: "El nombre del producto es obligatorio." });
    const duplicate = products.find((row) => row.id !== id && String(row.name || "").trim().toLowerCase() === nextName.toLowerCase());
    if (duplicate) return res.status(409).json({ error: "Ya existe un producto con ese nombre." });
    product.name = nextName;
  }
  if (req.body?.unitPrice !== undefined) {
    product.unitPrice = Math.max(0, parseNumber(req.body?.unitPrice));
  }
  if (req.body?.ownProduction !== undefined) {
    product.ownProduction = req.body?.ownProduction === true;
  }
  if (req.body?.active !== undefined) {
    product.active = req.body?.active !== false;
  }

  data.products = products;
  writeDb(data);
  return res.status(200).json({ ok: true, product });
});

app.get("/api/inventory", (_req, res) => {
  const data = readDb();
  return res.json({ inventory: (data.inventory || []).map(normalizeInventoryItem) });
});

app.post("/api/inventory", (req, res) => {
  const data = readDb();
  const productId = String(req.body?.productId || "").trim();
  const productName = String(req.body?.productName || "").trim();
  const quantity = Math.max(0, parseNumber(req.body?.quantity));
  if (!productId || !productName) return res.status(400).json({ error: "Producto obligatorio." });

  const inventory = (data.inventory || []).map(normalizeInventoryItem);
  const current = inventory.find((item) => item.productId === productId);
  if (current) {
    current.productName = productName;
    current.quantity = quantity;
    current.updatedAt = nowIso();
  } else {
    inventory.push(
      normalizeInventoryItem({
        id: uid("inv"),
        productId,
        productName,
        quantity,
        updatedAt: nowIso()
      })
    );
  }
  data.inventory = inventory;
  writeDb(data);
  return res.status(200).json({ ok: true, inventory });
});

app.post("/api/inventory/transfer", (req, res) => {
  const data = readDb();
  const sellerId = String(req.body?.sellerId || "").trim();
  const productId = String(req.body?.productId || "").trim();
  const qty = Math.max(0, parseNumber(req.body?.quantity));
  if (!sellerId || !productId || qty <= 0) return res.status(400).json({ error: "Vendedor, producto y cantidad son obligatorios." });

  const seller = data.sellers.map(normalizeSeller).find((item) => item.id === sellerId && item.role === "seller" && item.active);
  if (!seller) return res.status(404).json({ error: "Vendedor no encontrado." });

  const inventory = (data.inventory || []).map(normalizeInventoryItem);
  const invItem = inventory.find((item) => item.productId === productId);
  if (!invItem) return res.status(404).json({ error: "Producto no encontrado en inventario." });
  if (parseNumber(invItem.quantity) < qty) return res.status(400).json({ error: `Inventario insuficiente. Disponible: ${parseNumber(invItem.quantity)}.` });

  invItem.quantity = Math.max(0, parseNumber(invItem.quantity) - qty);
  invItem.updatedAt = nowIso();
  data.inventory = inventory;

  const stocks = Array.isArray(data.sellerStocks) ? data.sellerStocks : [];
  const currentStock = stocks.find((item) => String(item.sellerId) === sellerId && String(item.productId) === productId);
  if (currentStock) {
    currentStock.quantity = parseNumber(currentStock.quantity) + qty;
    currentStock.productName = invItem.productName;
    currentStock.updatedAt = nowIso();
  } else {
    stocks.push({
      id: uid("seller_stock"),
      sellerId,
      productId,
      productName: invItem.productName,
      quantity: qty,
      notes: "Asignado desde inventario",
      updatedAt: nowIso()
    });
  }
  data.sellerStocks = stocks;
  writeDb(data);
  return res.status(200).json({ ok: true });
});

app.get("/api/production", (_req, res) => {
  const data = readDb();
  return res.status(200).json({
    rawMaterials: (data.rawMaterials || []).map(normalizeRawMaterial),
    rawMaterialRestocks: (data.rawMaterialRestocks || []).map(normalizeRawMaterialRestock).sort((a, b) => new Date(`${b.date}T00:00:00`) - new Date(`${a.date}T00:00:00`)),
    productionRecipes: (data.productionRecipes || []).map(normalizeProductionRecipe),
    productionBatches: (data.productionBatches || []).map(normalizeProductionBatch).sort((a, b) => new Date(b.date) - new Date(a.date)),
    productionSummary: computeProductionSummary(data)
  });
});

app.post("/api/production/raw-materials", (req, res) => {
  const data = readDb();
  const body = req.body || {};
  const material = normalizeRawMaterial({
    id: uid("raw"),
    name: body.name,
    unit: body.unit,
    stockQty: body.stockQty,
    costPerUnit: body.costPerUnit,
    appliesToProductIds: body.appliesToProductIds,
    lastRestockAt: nowIso(),
    updatedAt: nowIso()
  });
  if (!material.name) return res.status(400).json({ error: "Nombre de materia prima obligatorio." });

  const materials = (data.rawMaterials || []).map(normalizeRawMaterial);
  const current = materials.find((row) => String(row.name || "").trim().toLowerCase() === material.name.toLowerCase());
  if (current) {
    return res.status(409).json({ error: "La materia prima ya existe. Usa la opcion de recarga para aumentar stock." });
  }
  materials.unshift(material);
  data.rawMaterials = materials;
  writeDb(data);
  return res.status(201).json({ ok: true, rawMaterials: data.rawMaterials });
});

app.put("/api/production/raw-materials/:id", (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ error: "ID invalido." });

  const data = readDb();
  const materials = (data.rawMaterials || []).map(normalizeRawMaterial);
  const current = materials.find((row) => row.id === id);
  if (!current) return res.status(404).json({ error: "Materia prima no encontrada." });

  current.name = String(req.body?.name ?? current.name).trim() || current.name;
  current.unit = String(req.body?.unit ?? current.unit).trim() || current.unit;
  current.stockQty = Math.max(0, parseNumber(req.body?.stockQty ?? current.stockQty));
  current.costPerUnit = Math.max(0, parseNumber(req.body?.costPerUnit ?? current.costPerUnit));
  current.appliesToProductIds = Array.isArray(req.body?.appliesToProductIds)
    ? req.body.appliesToProductIds.map((value) => String(value || "").trim()).filter(Boolean)
    : current.appliesToProductIds;
  current.updatedAt = nowIso();
  data.rawMaterials = materials;
  writeDb(data);
  return res.status(200).json({ ok: true, material: current });
});

app.post("/api/production/raw-materials/:id/restock", (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ error: "ID invalido." });

  const qtyAdded = Math.max(0, parseNumber(req.body?.qtyAdded));
  const unitCost = Math.max(0, parseNumber(req.body?.unitCost));
  const date = String(req.body?.date || localDateIso()).trim();
  const supplier = String(req.body?.supplier || "").trim();
  const notes = String(req.body?.notes || "").trim();
  if (qtyAdded <= 0) return res.status(400).json({ error: "La cantidad de recarga debe ser mayor que cero." });

  const data = readDb();
  const materials = (data.rawMaterials || []).map(normalizeRawMaterial);
  const material = materials.find((row) => row.id === id);
  if (!material) return res.status(404).json({ error: "Materia prima no encontrada." });

  const previousStockQty = Math.max(0, parseNumber(material.stockQty));
  const previousCostPerUnit = Math.max(0, parseNumber(material.costPerUnit));
  const newStockQty = previousStockQty + qtyAdded;

  let newCostPerUnit = previousCostPerUnit;
  if (newStockQty > 0) {
    const previousTotalCost = previousStockQty * previousCostPerUnit;
    const addedTotalCost = qtyAdded * unitCost;
    newCostPerUnit = (previousTotalCost + addedTotalCost) / newStockQty;
  }

  material.stockQty = newStockQty;
  material.costPerUnit = newCostPerUnit;
  material.lastRestockAt = nowIso();
  material.updatedAt = nowIso();

  const restocks = (data.rawMaterialRestocks || []).map(normalizeRawMaterialRestock);
  restocks.unshift(
    normalizeRawMaterialRestock({
      id: uid("raw_restock"),
      materialId: material.id,
      materialName: material.name,
      date,
      qtyAdded,
      unit: material.unit,
      unitCost,
      totalCost: qtyAdded * unitCost,
      previousStockQty,
      newStockQty,
      previousCostPerUnit,
      newCostPerUnit,
      supplier,
      notes,
      createdAt: nowIso()
    })
  );

  data.rawMaterials = materials;
  data.rawMaterialRestocks = restocks;
  writeDb(data);
  return res.status(201).json({ ok: true, material, lastRestock: restocks[0] });
});

app.post("/api/production/recipes", (req, res) => {
  const data = readDb();
  const body = req.body || {};
  const productId = String(body.productId || "").trim();
  const productName = String(body.productName || "").trim();
  if (!productName) return res.status(400).json({ error: "Producto obligatorio para receta." });

  const recipe = normalizeProductionRecipe({
    id: uid("recipe"),
    productId,
    productName,
    yieldQty: body.yieldQty,
    components: body.components,
    updatedAt: nowIso()
  });
  if (recipe.components.length === 0) return res.status(400).json({ error: "La receta debe tener al menos una materia prima." });

  const recipes = (data.productionRecipes || []).map(normalizeProductionRecipe);
  const current = recipes.find(
    (row) =>
      (productId && row.productId === productId) ||
      String(row.productName || "").trim().toLowerCase() === productName.toLowerCase()
  );
  if (current) {
    current.productId = productId || current.productId;
    current.productName = recipe.productName;
    current.yieldQty = recipe.yieldQty;
    current.components = recipe.components;
    current.updatedAt = nowIso();
  } else {
    recipes.unshift(recipe);
  }
  data.productionRecipes = recipes;
  writeDb(data);
  return res.status(201).json({ ok: true, productionRecipes: recipes });
});

app.post("/api/production/batches", (req, res) => {
  const data = readDb();
  const body = req.body || {};
  const productId = String(body.productId || "").trim();
  const productName = String(body.productName || "").trim();
  const outputQty = Math.max(0, parseNumber(body.outputQty));
  const date = String(body.date || localDateIso()).trim();
  if (!productName || outputQty <= 0) return res.status(400).json({ error: "Producto y cantidad producida son obligatorios." });

  const recipes = (data.productionRecipes || []).map(normalizeProductionRecipe);
  const recipe = recipes.find(
    (row) =>
      (productId && row.productId === productId) ||
      String(row.productName || "").trim().toLowerCase() === productName.toLowerCase()
  );
  if (!recipe) return res.status(400).json({ error: "No existe receta para este producto." });

  const materials = (data.rawMaterials || []).map(normalizeRawMaterial);
  const factor = outputQty / Math.max(0.0001, parseNumber(recipe.yieldQty));
  const materialsUsed = [];
  for (const component of recipe.components) {
    const material = materials.find((row) => row.id === component.materialId);
    if (!material) return res.status(400).json({ error: `Materia prima no encontrada en receta: ${component.materialName}` });
    const requiredQty = parseNumber(component.qty) * factor;
    if (parseNumber(material.stockQty) < requiredQty) {
      return res.status(400).json({
        error: `Stock insuficiente de materia prima: ${material.name}. Disponible ${parseNumber(material.stockQty).toFixed(2)} ${material.unit}, requerido ${requiredQty.toFixed(2)} ${material.unit}.`
      });
    }
    material.stockQty = Math.max(0, parseNumber(material.stockQty) - requiredQty);
    material.updatedAt = nowIso();
    materialsUsed.push({
      materialId: material.id,
      materialName: material.name,
      qty: requiredQty,
      unit: material.unit,
      costPerUnit: parseNumber(material.costPerUnit),
      totalCost: requiredQty * parseNumber(material.costPerUnit)
    });
  }

  const totalCost = materialsUsed.reduce((acc, row) => acc + parseNumber(row.totalCost), 0);
  const unitCost = outputQty > 0 ? totalCost / outputQty : 0;
  const batch = normalizeProductionBatch({
    id: uid("batch"),
    date,
    productId,
    productName,
    outputQty,
    totalCost,
    unitCost,
    notes: String(body.notes || "").trim(),
    materialsUsed,
    createdAt: nowIso()
  });

  const inventory = (data.inventory || []).map(normalizeInventoryItem);
  const invItem = findInventoryItemByProduct(inventory, productId, productName);
  if (invItem) {
    invItem.quantity = Math.max(0, parseNumber(invItem.quantity) + outputQty);
    invItem.productName = productName || invItem.productName;
    invItem.updatedAt = nowIso();
  } else {
    inventory.push(
      normalizeInventoryItem({
        id: uid("inv"),
        productId,
        productName,
        quantity: outputQty,
        updatedAt: nowIso()
      })
    );
  }

  data.rawMaterials = materials;
  data.inventory = inventory;
  data.productionRecipes = recipes;
  data.productionBatches = [batch, ...((data.productionBatches || []).map(normalizeProductionBatch))];
  writeDb(data);
  return res.status(201).json({ ok: true, batch });
});

app.post("/api/product-goals/owner", (req, res) => {
  const data = readDb();
  const productId = String(req.body?.productId || "").trim();
  const productName = String(req.body?.productName || "").trim();
  const targetQty = Math.max(0, parseNumber(req.body?.targetQty));
  if (!productName) return res.status(400).json({ error: "Producto obligatorio." });

  const goals = (data.productGoals || []).map(normalizeProductGoal);
  const current = goals.find((goal) => goal.ownerType === "owner" && (goal.productId === productId || goal.productName.toLowerCase() === productName.toLowerCase()));
  if (current) {
    current.productId = productId || current.productId;
    current.productName = productName;
    current.targetQty = targetQty;
  } else {
    goals.unshift(
      normalizeProductGoal({
        ownerType: "owner",
        ownerId: "",
        productId,
        productName,
        targetQty,
        createdAt: nowIso()
      })
    );
  }
  data.productGoals = goals;
  writeDb(data);
  return res.status(200).json({ ok: true, goals: goals.filter((g) => g.ownerType === "owner") });
});

app.get("/api/lookup/cep/:cep", async (req, res) => {
  const cep = cleanDigits(req.params.cep);
  if (cep.length !== 8) {
    return res.status(400).json({ error: "CEP invalido. Debe tener 8 digitos." });
  }

  try {
    const viaCep = await fetchJson(`https://viacep.com.br/ws/${cep}/json/`);
    if (viaCep?.erro) {
      return res.status(404).json({ error: "CEP no encontrado." });
    }

    return res.json({
      cep,
      street: String(viaCep.logradouro || "").trim(),
      neighborhood: String(viaCep.bairro || "").trim(),
      city: String(viaCep.localidade || "").trim(),
      state: String(viaCep.uf || "").trim()
    });
  } catch {
    return res.status(502).json({ error: "No fue posible consultar el CEP ahora." });
  }
});

app.get("/api/lookup/cnpj/:cnpj", async (req, res) => {
  const cnpj = cleanDigits(req.params.cnpj);
  if (cnpj.length !== 14) {
    return res.status(400).json({ error: "CNPJ invalido. Debe tener 14 digitos." });
  }

  // Try BrasilAPI first.
  try {
    const brasilApi = await fetchJson(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);

    return res.json({
      cnpj,
      tradeName: String(brasilApi.nome_fantasia || brasilApi.razao_social || "").trim(),
      legalName: String(brasilApi.razao_social || "").trim(),
      email: String(brasilApi.email || "").trim(),
      phone: String(brasilApi.ddd_telefone_1 || brasilApi.ddd_telefone_2 || "").trim(),
      ie: String(brasilApi.inscricoes_estaduais?.[0]?.inscricao_estadual || "").trim(),
      cep: cleanDigits(brasilApi.cep || ""),
      street: String(brasilApi.logradouro || "").trim(),
      number: String(brasilApi.numero || "").trim(),
      neighborhood: String(brasilApi.bairro || "").trim(),
      city: String(brasilApi.municipio || "").trim(),
      state: String(brasilApi.uf || "").trim()
    });
  } catch {
    // Fallback: ReceitaWS.
    try {
      const receitaWs = await fetchJson(`https://www.receitaws.com.br/v1/cnpj/${cnpj}`, 15000);
      if (String(receitaWs.status || "").toUpperCase() === "ERROR") {
        return res.status(404).json({ error: String(receitaWs.message || "CNPJ no encontrado.") });
      }

      return res.json({
        cnpj,
        tradeName: String(receitaWs.fantasia || receitaWs.nome || "").trim(),
        legalName: String(receitaWs.nome || "").trim(),
        email: String(receitaWs.email || "").trim(),
        phone: String(receitaWs.telefone || "").trim(),
        ie: "",
        cep: cleanDigits(receitaWs.cep || ""),
        street: String(receitaWs.logradouro || "").trim(),
        number: String(receitaWs.numero || "").trim(),
        neighborhood: String(receitaWs.bairro || "").trim(),
        city: String(receitaWs.municipio || "").trim(),
        state: String(receitaWs.uf || "").trim()
      });
    } catch {
      return res.status(502).json({ error: "No fue posible consultar el CNPJ ahora. Verifica internet o intenta luego." });
    }
  }
});

app.post("/api/clients", (req, res) => {
  const body = req.body || {};
  const normalized = normalizeClient(body);

  if (!normalized.tradeName) {
    return res.status(400).json({ error: "El nombre del cliente es obligatorio." });
  }

  const data = readDb();
  const { sellers, changed } = ensureDefaultSellers(data);
  if (changed) {
    data.sellers = sellers;
  }

  if (normalized.managedByType === "seller") {
    const sellerExists = sellers.some((seller) => seller.id === normalized.managedBySellerId && seller.active);
    if (!sellerExists) {
      return res.status(400).json({ error: "Selecciona un vendedor valido para este cliente." });
    }
  }

  if (hasDuplicateClient(data.clients, normalized)) {
    return res.status(409).json({ error: "Ya existe un cliente con estos datos (CPF/CNPJ o comercio+responsable)." });
  }

  const newClient = normalizeClient({
    id: uid("client"),
    ...normalized,
    internalId: getNextInternalId(data.clients),
    createdAt: new Date().toISOString()
  });

  data.clients.unshift(newClient);
  writeDb(data);

  return res.status(201).json(newClient);
});

app.put("/api/clients/:id", (req, res) => {
  const clientId = String(req.params.id || "").trim();
  if (!clientId) return res.status(400).json({ error: "ID de cliente invalido." });

  const body = req.body || {};
  const normalized = normalizeClient(body);
  if (!normalized.tradeName) {
    return res.status(400).json({ error: "El nombre del cliente es obligatorio." });
  }

  const data = readDb();
  const { sellers, changed } = ensureDefaultSellers(data);
  if (changed) {
    data.sellers = sellers;
  }

  const index = data.clients.findIndex((client) => String(client.id) === clientId);
  if (index < 0) return res.status(404).json({ error: "Cliente no encontrado." });

  if (normalized.managedByType === "seller") {
    const sellerExists = sellers.some((seller) => seller.id === normalized.managedBySellerId && seller.active);
    if (!sellerExists) {
      return res.status(400).json({ error: "Selecciona un vendedor valido para este cliente." });
    }
  }

  if (hasDuplicateClient(data.clients, normalized, { excludeId: clientId })) {
    return res.status(409).json({ error: "Ya existe otro cliente con estos datos (CPF/CNPJ o comercio+responsable)." });
  }

  const current = normalizeClient(data.clients[index] || {});
  const updated = normalizeClient({
    ...current,
    ...normalized,
    id: current.id,
    internalId: String(current.internalId || "").trim(),
    createdAt: current.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  data.clients[index] = updated;
  writeDb(data);
  return res.status(200).json(updated);
});

app.delete("/api/clients/:id", (req, res) => {
  const clientId = String(req.params.id || "").trim();
  if (!clientId) return res.status(400).json({ error: "ID de cliente invalido." });

  const data = readDb();
  const index = data.clients.findIndex((client) => String(client.id) === clientId);
  if (index < 0) return res.status(404).json({ error: "Cliente no encontrado." });

  const hasVisits = (data.visits || []).some((visit) => String(visit.clientId) === clientId);
  if (hasVisits) {
    return res.status(409).json({ error: "No se puede eliminar: este cliente tiene visitas registradas." });
  }

  data.clients = data.clients.filter((client) => String(client.id) !== clientId);
  data.appointments = (data.appointments || []).filter((appointment) => String(appointment.clientId) !== clientId);
  data.clientMovements = (data.clientMovements || []).filter((movement) => String(movement.clientId) !== clientId);
  writeDb(data);
  return res.json({ ok: true });
});

app.get("/api/clients/:id/movements", (req, res) => {
  const clientId = String(req.params.id || "").trim();
  if (!clientId) return res.status(400).json({ error: "ID de cliente invalido." });

  const data = readDb();
  const client = (data.clients || []).map(normalizeClient).find((item) => String(item.id) === clientId);
  if (!client) return res.status(404).json({ error: "Cliente no encontrado." });

  const movements = (data.clientMovements || [])
    .map(normalizeClientMovement)
    .filter((movement) => String(movement.clientId) === clientId)
    .sort((a, b) => new Date(`${b.date}T00:00:00`) - new Date(`${a.date}T00:00:00`));

  return res.status(200).json({ movements });
});

app.post("/api/clients/:id/movements", (req, res) => {
  const clientId = String(req.params.id || "").trim();
  if (!clientId) return res.status(400).json({ error: "ID de cliente invalido." });

  const data = readDb();
  const client = (data.clients || []).map(normalizeClient).find((item) => String(item.id) === clientId);
  if (!client) return res.status(404).json({ error: "Cliente no encontrado." });

  const body = req.body || {};
  const movement = normalizeClientMovement({
    id: uid("mov"),
    clientId,
    date: String(body.date || localDateIso()).trim(),
    type: String(body.type || "ajuste").trim().toLowerCase(),
    productId: String(body.productId || "").trim(),
    productName: String(body.productName || "").trim(),
    quantity: body.quantity,
    notes: body.notes,
    createdBySellerId: String(body.createdBySellerId || "").trim(),
    createdAt: nowIso()
  });

  if (!movement.productName) {
    return res.status(400).json({ error: "Producto obligatorio para registrar movimiento." });
  }
  if (movement.quantity <= 0) {
    return res.status(400).json({ error: "Cantidad debe ser mayor a 0." });
  }

  data.clientMovements = [movement, ...(Array.isArray(data.clientMovements) ? data.clientMovements : [])];
  writeDb(data);
  return res.status(201).json({ movement });
});

app.get("/api/sellers", (_req, res) => {
  const data = readDb();
  const sellersState = ensureDefaultSellers(data);
  const usersState = ensureDefaultSellerUsers(data, sellersState.sellers);
  if (sellersState.changed || usersState.changed) {
    data.sellers = sellersState.sellers;
    data.sellerUsers = usersState.users;
    writeDb(data);
  }
  return res.json({
    sellers: sellersState.sellers.map(normalizeSeller),
    users: (data.sellerUsers || []).map(normalizeSellerUser).map((user) => ({ id: user.id, sellerId: user.sellerId, username: user.username, active: user.active }))
  });
});

app.post("/api/seller-auth/login", (req, res) => {
  const username = String(req.body?.username || "").trim().toLowerCase();
  const pin = String(req.body?.pin || "").trim();
  if (!username || !pin) return res.status(400).json({ error: "Usuario y PIN son obligatorios." });

  const data = readDb();
  const sellersState = ensureDefaultSellers(data);
  const usersState = ensureDefaultSellerUsers(data, sellersState.sellers);
  data.sellers = sellersState.sellers;
  data.sellerUsers = usersState.users;
  cleanExpiredSessions(data);

  const user = data.sellerUsers.map(normalizeSellerUser).find((item) => item.username === username && item.active);
  if (!user) return res.status(401).json({ error: "Credenciales invalidas." });
  if (user.pinHash !== hashPin(pin)) return res.status(401).json({ error: "Credenciales invalidas." });

  const seller = data.sellers.map(normalizeSeller).find((item) => item.id === user.sellerId && item.active);
  if (!seller || seller.role !== "seller") return res.status(403).json({ error: "Usuario sin perfil de vendedor." });

  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
  data.sellerSessions = [...(data.sellerSessions || []), { id: uid("session"), token, sellerUserId: user.id, sellerId: seller.id, createdAt: nowIso(), expiresAt }];
  writeDb(data);

  const appData = buildSellerAppData(data, seller.id);
  return res.status(200).json({
    token,
    expiresAt,
    user: { id: user.id, username: user.username, sellerId: user.sellerId },
    seller: appData?.seller || { id: seller.id, name: seller.name }
  });
});

app.post("/api/seller-auth/logout", (req, res) => {
  const token = parseBearerToken(req.headers?.authorization || "");
  if (!token) return res.status(200).json({ ok: true });
  const data = readDb();
  data.sellerSessions = (data.sellerSessions || []).filter((item) => String(item.token) !== token);
  writeDb(data);
  return res.status(200).json({ ok: true });
});

app.get("/api/sellers/overview", (_req, res) => {
  const data = readDb();
  const sellers = data.sellers.map(normalizeSeller);
  return res.json({
    sellers,
    overview: computeSellersOverview(data, sellers)
  });
});

app.get("/api/seller-app/data", (req, res) => {
  const data = readDb();
  const ctx = getSellerAuthContext(data, req);
  if (!ctx) return res.status(401).json({ error: "Sesion invalida. Inicia sesion nuevamente." });
  const payload = buildSellerAppData(data, ctx.seller.id);
  if (!payload) return res.status(404).json({ error: "No se encontro informacion para este vendedor." });
  writeDb(data);
  return res.json(payload);
});

app.post("/api/seller-app/clients", (req, res) => {
  const data = readDb();
  const ctx = getSellerAuthContext(data, req);
  if (!ctx) return res.status(401).json({ error: "Sesion invalida. Inicia sesion nuevamente." });
  const body = req.body || {};
  const normalized = normalizeClient(body);
  if (!normalized.tradeName) return res.status(400).json({ error: "Nombre comercio obligatorio." });
  if (hasDuplicateClient(data.clients, normalized, { scopeSellerId: ctx.seller.id })) {
    return res.status(409).json({ error: "Ya existe este cliente en tu cartera (CPF/CNPJ o comercio+responsable)." });
  }

  const newClient = normalizeClient({
    id: uid("client"),
    ...normalized,
    internalId: getNextInternalId(data.clients),
    managedByType: "seller",
    managedBySellerId: ctx.seller.id,
    createdAt: nowIso()
  });
  data.clients.unshift(newClient);
  writeDb(data);
  return res.status(201).json(newClient);
});

app.post("/api/seller-app/clients/:id/movements", (req, res) => {
  const data = readDb();
  const ctx = getSellerAuthContext(data, req);
  if (!ctx) return res.status(401).json({ error: "Sesion invalida." });

  const clientId = String(req.params.id || "").trim();
  if (!clientId) return res.status(400).json({ error: "ID de cliente invalido." });

  const client = (data.clients || []).map(normalizeClient).find((item) => String(item.id) === clientId);
  if (!client) return res.status(404).json({ error: "Cliente no encontrado." });
  if (client.managedByType !== "seller" || client.managedBySellerId !== ctx.seller.id) {
    return res.status(403).json({ error: "No puedes registrar cambios para clientes de otro vendedor." });
  }

  const body = req.body || {};
  const movement = normalizeClientMovement({
    id: uid("mov"),
    clientId,
    date: String(body.date || localDateIso()).trim(),
    type: String(body.type || "ajuste").trim().toLowerCase(),
    productId: String(body.productId || "").trim(),
    productName: String(body.productName || "").trim(),
    quantity: body.quantity,
    notes: body.notes,
    createdBySellerId: ctx.seller.id,
    createdAt: nowIso()
  });

  if (!movement.productName) {
    return res.status(400).json({ error: "Producto obligatorio para registrar movimiento." });
  }
  if (movement.quantity <= 0) {
    return res.status(400).json({ error: "Cantidad debe ser mayor a 0." });
  }

  data.clientMovements = [movement, ...(Array.isArray(data.clientMovements) ? data.clientMovements : [])];
  writeDb(data);
  return res.status(201).json({ movement });
});

app.post("/api/seller-app/goals", (req, res) => {
  const data = readDb();
  const ctx = getSellerAuthContext(data, req);
  if (!ctx) return res.status(401).json({ error: "Sesion invalida. Inicia sesion nuevamente." });
  const sellerId = ctx.seller.id;
  const seller = data.sellers.map(normalizeSeller).find((item) => item.id === sellerId);
  if (!seller) return res.status(404).json({ error: "Vendedor no encontrado." });

  const nextSeller = {
    ...seller,
    weeklyGoal: Math.max(0, parseNumber(req.body?.weeklyGoal ?? seller.weeklyGoal)),
    monthlyGoal: Math.max(0, parseNumber(req.body?.monthlyGoal ?? seller.monthlyGoal))
  };
  data.sellers = data.sellers.map((raw) => (String(raw.id) === sellerId ? nextSeller : normalizeSeller(raw)));
  writeDb(data);
  return res.status(200).json(nextSeller);
});

app.post("/api/seller-app/product-goals", (req, res) => {
  const data = readDb();
  const ctx = getSellerAuthContext(data, req);
  if (!ctx) return res.status(401).json({ error: "Sesion invalida. Inicia sesion nuevamente." });
  const productId = String(req.body?.productId || "").trim();
  const productName = String(req.body?.productName || "").trim();
  const targetQty = Math.max(0, parseNumber(req.body?.targetQty));
  if (!productName) return res.status(400).json({ error: "Producto obligatorio." });

  const goals = (data.productGoals || []).map(normalizeProductGoal);
  const current = goals.find(
    (goal) =>
      goal.ownerType === "seller" &&
      goal.ownerId === ctx.seller.id &&
      (goal.productId === productId || goal.productName.toLowerCase() === productName.toLowerCase())
  );
  if (current) {
    current.productId = productId || current.productId;
    current.productName = productName;
    current.targetQty = targetQty;
  } else {
    goals.unshift(
      normalizeProductGoal({
        ownerType: "seller",
        ownerId: ctx.seller.id,
        productId,
        productName,
        targetQty,
        createdAt: nowIso()
      })
    );
  }
  data.productGoals = goals;
  writeDb(data);
  return res.status(200).json({ ok: true, goals: goals.filter((g) => g.ownerType === "seller" && g.ownerId === ctx.seller.id) });
});

app.post("/api/seller-app/stock", (req, res) => {
  const data = readDb();
  const ctx = getSellerAuthContext(data, req);
  if (!ctx) return res.status(401).json({ error: "Sesion invalida. Inicia sesion nuevamente." });
  const sellerId = ctx.seller.id;
  const productId = String(req.body?.productId || "").trim();
  const productName = String(req.body?.productName || "").trim();
  const quantity = parseNumber(req.body?.quantity);
  if (!productId || !productName) return res.status(400).json({ error: "Producto obligatorio." });

  const stocks = Array.isArray(data.sellerStocks) ? data.sellerStocks : [];
  const current = stocks.find((item) => String(item.sellerId) === sellerId && String(item.productId) === productId);
  if (current) {
    current.quantity = quantity;
    current.productName = productName;
    current.notes = String(req.body?.notes || current.notes || "").trim();
    current.updatedAt = nowIso();
  } else {
    stocks.push({
      id: uid("seller_stock"),
      sellerId,
      productId,
      productName,
      quantity,
      notes: String(req.body?.notes || "").trim(),
      updatedAt: nowIso()
    });
  }
  data.sellerStocks = stocks;
  writeDb(data);
  return res.status(200).json({ ok: true });
});

app.post("/api/seller-app/visits", (req, res) => {
  const data = readDb();
  const ctx = getSellerAuthContext(data, req);
  if (!ctx) return res.status(401).json({ error: "Sesion invalida. Inicia sesion nuevamente." });
  const body = req.body || {};
  const visitTypeInput = String(body.visitType || "dispatch").trim().toLowerCase();
  const visitType = visitTypeInput === "count_only" ? "count_only" : visitTypeInput === "degustacion" ? "degustacion" : "dispatch";
  const isCountOnly = visitType === "count_only";
  const isDegustation = visitType === "degustacion";
  const clientId = String(body.clientId || "").trim();
  if (!body.date) return res.status(400).json({ error: "Fecha obligatoria." });
  if (!isDegustation && !clientId) return res.status(400).json({ error: "Cliente obligatorio para esta visita." });

  const client = clientId ? data.clients.map(normalizeClient).find((item) => item.id === clientId) : null;
  if (clientId && !client) return res.status(404).json({ error: "Cliente no encontrado." });
  if (client && (client.managedByType !== "seller" || client.managedBySellerId !== ctx.seller.id)) {
    return res.status(403).json({ error: "No puedes registrar visitas para clientes de otro vendedor." });
  }

  let prospectId = "";
  let prospectTradeName = "";
  let prospectBuyerName = "";
  if (isDegustation && !client) {
    const tradeName = String(body.prospectTradeName || body.prospectName || "").trim();
    if (!tradeName) {
      return res.status(400).json({ error: "En degustacion debes indicar nombre del comercio prospecto o seleccionar cliente." });
    }
    const buyerName = String(body.prospectBuyerName || body.prospectContact || "").trim();
    const phone = String(body.prospectPhone || body.phone || "").trim();
    const notesBase = String(body.prospectNotes || body.notes || "").trim();
    const newProspect = normalizeProspect({
      id: uid("prospect"),
      tradeName,
      buyerName,
      phone,
      notes: notesBase,
      createdByType: "seller",
      createdBySellerId: ctx.seller.id,
      firstVisitDate: String(body.date || localDateIso()),
      lastVisitDate: String(body.date || localDateIso())
    });
    const prospects = Array.isArray(data.prospects) ? data.prospects.map(normalizeProspect) : [];
    prospects.unshift(newProspect);
    data.prospects = prospects;
    prospectId = newProspect.id;
    prospectTradeName = newProspect.tradeName;
    prospectBuyerName = newProspect.buyerName;
  }

  const hasAmountCollected = body.amountCollected !== undefined && body.amountCollected !== null && String(body.amountCollected).trim() !== "";
  if (!isDegustation && !hasAmountCollected) return res.status(400).json({ error: "Cantidad recibida es obligatoria (usa 0 si no cobraste)." });
  const amountCollected = isDegustation ? 0 : parseNumber(body.amountCollected);

  const delivered = parseNumber(body.delivered);
  const remaining = parseNumber(body.remaining);
  const clientVisits = getClientVisits(data.visits, clientId);
  const soldAmount = calculateSold(clientVisits, remaining, delivered);
  const saleType = isDegustation ? "degustacion" : String(body.saleType || body.paymentType || "consignado");
  if (isCountOnly && saleType === "consignado") {
    return res.status(400).json({ error: "En visita solo conteo, el tipo de cobro no puede ser consignado." });
  }
  const boletoDays = !isDegustation && saleType === "boleto" ? Number(body.boletoDays || 7) : 0;
  const safeBoletoDays = boletoDays === 14 ? 14 : !isDegustation && saleType === "boleto" ? 7 : 0;
  const collectionMethod = isDegustation ? "" : String(body.collectionMethod || "").trim().toLowerCase();

  const rawItems = Array.isArray(body.items) ? body.items : [];
  const items = rawItems
    .map((item) => {
      const quantity = parseNumber(item.quantity);
      const unitPrice = isCountOnly || isDegustation ? 0 : parseNumber(item.unitPrice);
      const total = isCountOnly || isDegustation ? 0 : parseNumber(item.total || quantity * unitPrice);
      const hasRemaining = item.remaining !== undefined && item.remaining !== null && String(item.remaining).trim() !== "";
      return {
        productId: String(item.productId || "").trim(),
        productName: String(item.productName || "").trim(),
        quantity,
        unitPrice,
        total,
        remaining: hasRemaining ? parseNumber(item.remaining) : null
      };
    })
    .filter((item) => item.productName && (isCountOnly ? true : item.quantity > 0));
  if (items.length === 0) return res.status(400).json({ error: isCountOnly ? "Debes agregar al menos un producto para conteo." : "Debes agregar al menos un producto despachado." });
  const missingRemainingItems = isDegustation ? [] : items.filter((item) => item.remaining === null || item.remaining === undefined);
  if (!isDegustation && missingRemainingItems.length > 0) {
    const names = missingRemainingItems.map((item) => item.productName).join(", ");
    return res.status(400).json({ error: `Falta 'restante' para: ${names}.` });
  }

  const totalUnits = isCountOnly ? 0 : items.reduce((acc, item) => acc + item.quantity, 0);
  const totalValue = isCountOnly || isDegustation ? 0 : items.reduce((acc, item) => acc + item.total, 0);
  let dueDate = "";
  if (saleType === "boleto" && safeBoletoDays > 0) {
    const due = new Date(`${String(body.date)}T00:00:00`);
    due.setDate(due.getDate() + safeBoletoDays);
    dueDate = due.toISOString().slice(0, 10);
  }

  const newVisit = {
    id: uid("visit"),
    date: String(body.date),
    clientId,
    prospectId,
    prospectTradeName,
    prospectBuyerName,
    visitType,
    delivered: items.length ? totalUnits : delivered,
    remaining,
    soldAmount: isCountOnly || isDegustation ? 0 : (items.length ? totalValue : soldAmount),
    soldUnits: isCountOnly || isDegustation ? 0 : (items.length ? totalUnits : soldAmount),
    totalValue: isCountOnly || isDegustation ? 0 : (items.length ? totalValue : soldAmount),
    items,
    amountCollected,
    collectionMethod: collectionMethod || (amountCollected > 0 ? "efectivo" : ""),
    paymentType: isDegustation ? "degustacion" : String(body.paymentType || saleType || "consignado"),
    saleType,
    createdBySellerId: ctx.seller.id,
    boletoDays: safeBoletoDays,
    dueDate,
    boletoPaid: saleType === "boleto" ? false : true,
    boletoPaidAt: "",
    invoiceNumber: "",
    invoiceLocked: false,
    nextVisitDate: String(body.nextVisitDate || ""),
    notes: String(body.notes || "").trim()
  };

  if (!isDegustation && client) {
    autoConvertProspectsForClient(data, client);
  }

  // Discount stock from seller's pronta-entrega inventory.
  if (!isCountOnly) {
    const stocks = Array.isArray(data.sellerStocks) ? data.sellerStocks : [];
    for (const line of items) {
      const stock = findStockByProduct(stocks, line, ctx.seller.id);
      if (!stock) {
        return res.status(400).json({ error: `Sin stock cargado para ${line.productName}.` });
      }
      const currentQty = parseNumber(stock.quantity);
      if (currentQty < parseNumber(line.quantity)) {
        return res.status(400).json({ error: `Stock insuficiente para ${line.productName}. Disponible: ${currentQty}.` });
      }
      stock.quantity = currentQty - parseNumber(line.quantity);
      stock.updatedAt = nowIso();
    }
    data.sellerStocks = stocks;
  }

  data.visits.push(newVisit);
  if (newVisit.clientId) {
    const pendingAppointments = data.appointments
      .filter((appt) => appt.clientId === newVisit.clientId && appt.status === "pending")
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    const toClose = pendingAppointments.find((appt) => new Date(`${appt.date}T00:00:00`) <= new Date(`${newVisit.date}T23:59:59`));
    if (toClose) {
      toClose.status = "done";
      toClose.closedAt = nowIso();
    }

    // Auto-create next appointment when visit has nextVisitDate.
    if (newVisit.nextVisitDate) {
      const hasPendingForDate = data.appointments.some(
        (appt) =>
          appt.clientId === newVisit.clientId &&
          appt.status === "pending" &&
          String(appt.date) === String(newVisit.nextVisitDate)
      );
      if (!hasPendingForDate) {
        data.appointments.push({
          id: uid("appointment"),
          clientId: newVisit.clientId,
          date: String(newVisit.nextVisitDate),
          notes: "Agendada automaticamente desde visita",
          status: "pending",
          createdAt: nowIso()
        });
      }
    }
  }

  writeDb(data);
  return res.status(201).json(newVisit);
});

app.post("/api/seller-app/appointments", (req, res) => {
  const data = readDb();
  const ctx = getSellerAuthContext(data, req);
  if (!ctx) return res.status(401).json({ error: "Sesion invalida. Inicia sesion nuevamente." });
  const body = req.body || {};
  if (!body.clientId || !body.date) return res.status(400).json({ error: "Cliente y fecha son obligatorios para agendar visita." });

  const client = data.clients.map(normalizeClient).find((item) => item.id === String(body.clientId));
  if (!client) return res.status(404).json({ error: "Cliente no encontrado." });
  if (client.managedByType !== "seller" || client.managedBySellerId !== ctx.seller.id) {
    return res.status(403).json({ error: "No puedes agendar para clientes de otro vendedor." });
  }

  const appointment = {
    id: uid("appointment"),
    clientId: String(body.clientId),
    date: String(body.date),
    notes: String(body.notes || "").trim(),
    status: "pending",
    createdAt: nowIso()
  };
  data.appointments.push(appointment);
  writeDb(data);
  return res.status(201).json(appointment);
});

app.post("/api/sellers", (req, res) => {
  const body = req.body || {};
  const data = readDb();
  const seller = normalizeSeller({
    id: body.id || uid("seller"),
    name: body.name,
    role: body.role || "seller",
    phone: body.phone || "",
    commissionRate: body.commissionRate,
    weeklyGoal: body.weeklyGoal,
    monthlyGoal: body.monthlyGoal,
    active: body.active !== false
  });

  if (!seller.name) {
    return res.status(400).json({ error: "El nombre del vendedor es obligatorio." });
  }
  if (data.sellers.some((current) => current.id === seller.id)) {
    return res.status(409).json({ error: "Ya existe un vendedor con ese id." });
  }

  data.sellers.push(seller);
  writeDb(data);
  return res.status(201).json(seller);
});

app.post("/api/sellers/:sellerId/goals", (req, res) => {
  const sellerId = String(req.params.sellerId || "").trim();
  if (!sellerId) return res.status(400).json({ error: "Vendedor invalido." });
  const data = readDb();
  const seller = data.sellers.map(normalizeSeller).find((item) => item.id === sellerId);
  if (!seller) return res.status(404).json({ error: "Vendedor no encontrado." });

  const nextSeller = {
    ...seller,
    commissionRate: Math.max(0, parseNumber(req.body?.commissionRate ?? seller.commissionRate)),
    weeklyGoal: Math.max(0, parseNumber(req.body?.weeklyGoal ?? seller.weeklyGoal)),
    monthlyGoal: Math.max(0, parseNumber(req.body?.monthlyGoal ?? seller.monthlyGoal))
  };
  data.sellers = data.sellers.map((raw) => (String(raw.id) === sellerId ? nextSeller : normalizeSeller(raw)));
  writeDb(data);
  return res.status(200).json(nextSeller);
});

app.post("/api/sellers/:sellerId/stock", (req, res) => {
  const sellerId = String(req.params.sellerId || "").trim();
  if (!sellerId) return res.status(400).json({ error: "Vendedor invalido." });
  const productId = String(req.body?.productId || "").trim();
  const productName = String(req.body?.productName || "").trim();
  const quantity = parseNumber(req.body?.quantity);
  if (!productId || !productName) return res.status(400).json({ error: "Producto obligatorio." });

  const data = readDb();
  const seller = data.sellers.map(normalizeSeller).find((item) => item.id === sellerId);
  if (!seller) return res.status(404).json({ error: "Vendedor no encontrado." });

  const stocks = Array.isArray(data.sellerStocks) ? data.sellerStocks : [];
  const current = stocks.find((item) => String(item.sellerId) === sellerId && String(item.productId) === productId);
  if (current) {
    current.quantity = quantity;
    current.productName = productName;
    current.notes = String(req.body?.notes || current.notes || "").trim();
    current.updatedAt = new Date().toISOString();
  } else {
    stocks.push({
      id: uid("seller_stock"),
      sellerId,
      productId,
      productName,
      quantity,
      notes: String(req.body?.notes || "").trim(),
      updatedAt: new Date().toISOString()
    });
  }
  data.sellerStocks = stocks;
  writeDb(data);
  return res.status(200).json({ ok: true });
});

app.post("/api/sellers/:sellerId/clients/manage", (req, res) => {
  const sellerId = String(req.params.sellerId || "").trim();
  const clientId = String(req.body?.clientId || "").trim();
  const mode = String(req.body?.mode || "").trim().toLowerCase();
  if (!sellerId || !clientId) return res.status(400).json({ error: "Vendedor y cliente son obligatorios." });
  if (mode !== "assign" && mode !== "remove") return res.status(400).json({ error: "Modo invalido. Usa assign o remove." });

  const data = readDb();
  const seller = data.sellers.map(normalizeSeller).find((item) => item.id === sellerId && item.role === "seller" && item.active);
  if (!seller) return res.status(404).json({ error: "Vendedor no encontrado." });

  const normalizedClients = data.clients.map(normalizeClient);
  const idx = normalizedClients.findIndex((item) => item.id === clientId);
  if (idx < 0) return res.status(404).json({ error: "Cliente no encontrado." });

  const target = normalizedClients[idx];
  const nextClient =
    mode === "assign"
      ? { ...target, managedByType: "seller", managedBySellerId: sellerId }
      : { ...target, managedByType: "owner", managedBySellerId: "" };

  normalizedClients[idx] = nextClient;
  data.clients = normalizedClients;
  writeDb(data);
  return res.status(200).json({ ok: true, client: nextClient });
});

app.post("/api/visits", (req, res) => {
  const body = req.body || {};
  const visitTypeInput = String(body.visitType || "dispatch").trim().toLowerCase();
  const visitType = visitTypeInput === "count_only" ? "count_only" : visitTypeInput === "degustacion" ? "degustacion" : "dispatch";
  const isCountOnly = visitType === "count_only";
  const isDegustation = visitType === "degustacion";
  if (!body.date) return res.status(400).json({ error: "Fecha obligatoria." });

  const data = readDb();
  const clientId = String(body.clientId || "").trim();
  const client = clientId ? data.clients.find((item) => String(item.id) === clientId) : null;
  if (clientId && !client) return res.status(404).json({ error: "Cliente no encontrado." });
  if (!isDegustation && !clientId) return res.status(400).json({ error: "Cliente obligatorio para esta visita." });

  let prospectId = "";
  let prospectTradeName = "";
  let prospectBuyerName = "";
  if (isDegustation && !clientId) {
    const tradeName = String(body.prospectTradeName || body.prospectName || "").trim();
    const buyerName = String(body.prospectBuyerName || "").trim();
    const phone = String(body.prospectPhone || "").trim();
    if (!tradeName) {
      return res.status(400).json({ error: "En degustacion debes seleccionar cliente o indicar nombre del comercio prospecto." });
    }
    const existingProspects = Array.isArray(data.prospects) ? data.prospects.map(normalizeProspect) : [];
    const normalizedTrade = tradeName.toLowerCase();
    const normalizedBuyer = buyerName.toLowerCase();
    const existing =
      existingProspects.find((item) => String(item.id) === String(body.prospectId || "").trim()) ||
      existingProspects.find((item) => String(item.tradeName || "").trim().toLowerCase() === normalizedTrade && String(item.buyerName || "").trim().toLowerCase() === normalizedBuyer);
    const prospect = existing ||
      normalizeProspect({
        tradeName,
        buyerName,
        phone,
        notes: String(body.prospectNotes || "").trim()
      });
    if (!existing) data.prospects = [prospect, ...existingProspects];
    prospectId = prospect.id;
    prospectTradeName = prospect.tradeName;
    prospectBuyerName = prospect.buyerName;
  }

  const hasAmountCollected = body.amountCollected !== undefined && body.amountCollected !== null && String(body.amountCollected).trim() !== "";
  if (!isDegustation && !hasAmountCollected) {
    return res.status(400).json({ error: "Cantidad recibida es obligatoria (usa 0 si no cobraste)." });
  }
  const amountCollected = isDegustation ? 0 : parseNumber(body.amountCollected);

  const delivered = parseNumber(body.delivered);
  const remaining = parseNumber(body.remaining);
  const clientVisits = clientId ? getClientVisits(data.visits, clientId) : [];
  const soldAmount = calculateSold(clientVisits, remaining, delivered);
  const saleType = isDegustation ? "degustacion" : String(body.saleType || body.paymentType || "consignado");
  if (isCountOnly && saleType === "consignado") {
    return res.status(400).json({ error: "En visita solo conteo, el tipo de cobro no puede ser consignado." });
  }
  const collectionMethod = isDegustation ? "" : String(body.collectionMethod || "").trim().toLowerCase();
  const boletoDays = !isDegustation && saleType === "boleto" ? Number(body.boletoDays || 7) : 0;
  const safeBoletoDays = boletoDays === 14 ? 14 : saleType === "boleto" ? 7 : 0;

  const rawItems = Array.isArray(body.items) ? body.items : [];
  const items = rawItems
    .map((item) => {
      const quantity = parseNumber(item.quantity);
      const unitPrice = isDegustation ? 0 : parseNumber(item.unitPrice);
      const total = isDegustation ? 0 : parseNumber(item.total || quantity * unitPrice);
      const hasRemaining = item.remaining !== undefined && item.remaining !== null && String(item.remaining).trim() !== "";
      return {
        productId: String(item.productId || "").trim(),
        productName: String(item.productName || "").trim(),
        quantity,
        unitPrice,
        total,
        remaining: hasRemaining ? parseNumber(item.remaining) : null
      };
    })
    .filter((item) => item.productName && (isCountOnly ? true : item.quantity > 0));
  if (items.length === 0) {
    return res.status(400).json({ error: isCountOnly ? "Debes agregar al menos un producto para conteo." : "Debes agregar al menos un producto despachado." });
  }
  const missingRemainingItems = isDegustation ? [] : items.filter((item) => item.remaining === null || item.remaining === undefined);
  if (!isDegustation && missingRemainingItems.length > 0) {
    const names = missingRemainingItems.map((item) => item.productName).join(", ");
    return res.status(400).json({ error: `Falta 'restante' para: ${names}.` });
  }

  const totalUnits = isCountOnly ? 0 : items.reduce((acc, item) => acc + item.quantity, 0);
  const totalValue = isCountOnly || isDegustation ? 0 : items.reduce((acc, item) => acc + item.total, 0);

  let dueDate = "";
  if (saleType === "boleto" && safeBoletoDays > 0) {
    const due = new Date(`${String(body.date)}T00:00:00`);
    due.setDate(due.getDate() + safeBoletoDays);
    dueDate = due.toISOString().slice(0, 10);
  }

  const newVisit = {
    id: uid("visit"),
    date: String(body.date),
    clientId,
    prospectId,
    prospectTradeName,
    prospectBuyerName,
    visitType,
    delivered: items.length ? totalUnits : delivered,
    remaining,
    soldAmount: isCountOnly || isDegustation ? 0 : (items.length ? totalValue : soldAmount),
    soldUnits: isCountOnly || isDegustation ? 0 : (items.length ? totalUnits : soldAmount),
    totalValue: isCountOnly || isDegustation ? 0 : (items.length ? totalValue : soldAmount),
    items,
    amountCollected,
    collectionMethod: collectionMethod || (amountCollected > 0 ? "efectivo" : ""),
    paymentType: isDegustation ? "degustacion" : String(body.paymentType || saleType || "consignado"),
    saleType,
    boletoDays: safeBoletoDays,
    dueDate,
    boletoPaid: saleType === "boleto" ? false : true,
    boletoPaidAt: "",
    invoiceNumber: "",
    invoiceLocked: false,
    nextVisitDate: String(body.nextVisitDate || ""),
    notes: String(body.notes || "").trim()
  };

  // Discount from global inventory for admin dispatch/degustacion visits.
  if (!isCountOnly) {
    const inventory = (Array.isArray(data.inventory) ? data.inventory : []).map(normalizeInventoryItem);
    for (const line of items) {
      const byId = line.productId
        ? inventory.find((item) => String(item.productId) === line.productId)
        : null;
      const byName = inventory.find((item) => String(item.productName || "").trim().toLowerCase() === String(line.productName || "").trim().toLowerCase());
      const stock = byId || byName;
      if (!stock) {
        return res.status(400).json({ error: `Inventario no encontrado para ${line.productName}.` });
      }
      const currentQty = parseNumber(stock.quantity);
      const dispatchQty = parseNumber(line.quantity);
      if (currentQty < dispatchQty) {
        return res.status(400).json({ error: `Inventario insuficiente para ${line.productName}. Disponible: ${currentQty}.` });
      }
      stock.quantity = currentQty - dispatchQty;
      stock.updatedAt = nowIso();
    }
    data.inventory = inventory;
  }

  data.visits.push(newVisit);

  if (newVisit.clientId) {
    const pendingAppointments = data.appointments
      .filter((appt) => appt.clientId === newVisit.clientId && appt.status === "pending")
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    const toClose = pendingAppointments.find((appt) => new Date(`${appt.date}T00:00:00`) <= new Date(`${newVisit.date}T23:59:59`));
    if (toClose) {
      toClose.status = "done";
      toClose.closedAt = new Date().toISOString();
    }
  }

  writeDb(data);

  return res.status(201).json(newVisit);
});

app.post("/api/visits/:visitId/mark-paid", (req, res) => {
  const visitId = String(req.params.visitId || "").trim();
  if (!visitId) return res.status(400).json({ error: "Visita invalida." });

  const data = readDb();
  const visit = data.visits.find((item) => item.id === visitId);
  if (!visit) return res.status(404).json({ error: "Visita no encontrada." });

  const saleType = String(visit.saleType || "");
  if (saleType !== "boleto" && visit.paymentType !== "consignado") {
    return res.status(400).json({ error: "Solo visitas a credito pueden marcarse como pagadas." });
  }

  const total = parseNumber(visit.totalValue ?? visit.soldAmount);
  visit.amountCollected = total;
  visit.boletoPaid = true;
  visit.boletoPaidAt = new Date().toISOString();
  writeDb(data);

  return res.status(200).json(visit);
});

app.delete("/api/visits/:visitId", (req, res) => {
  const visitId = String(req.params.visitId || "").trim();
  if (!visitId) return res.status(400).json({ error: "Visita invalida." });

  const data = readDb();
  const visitIndex = (Array.isArray(data.visits) ? data.visits : []).findIndex((item) => String(item.id) === visitId);
  if (visitIndex < 0) return res.status(404).json({ error: "Visita no encontrada." });

  const visit = data.visits[visitIndex];
  restoreDispatchStockOnVisitDelete(data, visit);
  data.visits.splice(visitIndex, 1);
  writeDb(data);

  return res.status(200).json({ ok: true, visitId });
});

app.post("/api/appointments", (req, res) => {
  const body = req.body || {};

  if (!body.clientId || !body.date) {
    return res.status(400).json({ error: "Cliente y fecha son obligatorios para agendar visita." });
  }

  const data = readDb();
  const client = data.clients.find((item) => item.id === body.clientId);
  if (!client) {
    return res.status(404).json({ error: "Cliente no encontrado." });
  }

  const appointment = {
    id: uid("appointment"),
    clientId: String(body.clientId),
    date: String(body.date),
    notes: String(body.notes || "").trim(),
    status: "pending",
    createdAt: new Date().toISOString()
  };

  data.appointments.push(appointment);
  writeDb(data);

  return res.status(201).json(appointment);
});

app.post("/api/visits/:visitId/invoice", (req, res) => {
  const visitId = String(req.params.visitId || "").trim();
  const invoiceNumber = String(req.body?.invoiceNumber || "").trim();
  if (!visitId) return res.status(400).json({ error: "Visita invalida." });
  if (!invoiceNumber) return res.status(400).json({ error: "Numero de factura obligatorio." });

  const data = readDb();
  const visit = data.visits.find((item) => item.id === visitId);
  if (!visit) return res.status(404).json({ error: "Visita no encontrada." });
  if (visit.invoiceLocked || String(visit.invoiceNumber || "").trim()) {
    return res.status(409).json({ error: "La factura ya fue registrada y no puede editarse." });
  }

  visit.invoiceNumber = invoiceNumber;
  visit.invoiceLocked = true;
  visit.invoiceIssuedAt = new Date().toISOString();
  writeDb(data);
  return res.status(200).json(visit);
});

app.get("/api/reports/export", (req, res) => {
  const data = readDb();
  const { sellers } = ensureDefaultSellers(data);
  const sellerMap = new Map(sellers.map((seller) => [seller.id, seller.name]));

  const from = String(req.query.from || "").trim();
  const to = String(req.query.to || "").trim();
  const clientId = String(req.query.clientId || "").trim();
  const saleType = String(req.query.saleType || "all").trim();

  const clients = data.clients.map(normalizeClient);
  const clientMap = new Map(clients.map((client) => [client.id, client]));
  const clientDebtMap = new Map(clients.map((client) => [client.id, getClientDebt(data.visits, client.id)]));

  const visits = data.visits
    .filter((visit) => {
      if (from && String(visit.date) < from) return false;
      if (to && String(visit.date) > to) return false;
      if (clientId && String(visit.clientId) !== clientId) return false;
      if (saleType !== "all" && String(visit.saleType || "") !== saleType) return false;
      return true;
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const fmtMoney = (value) => `R$ ${parseNumber(value).toFixed(2)}`;
  const fmtUnits = (value) => `${parseNumber(value).toFixed(2)} unid`;

  const headers = [
    "Fecha despacho",
    "Dia semana",
    "ID interno cliente",
    "ID cliente",
    "Comercio",
    "Responsable compras",
    "Telefono",
    "Correo",
    "CNPJ",
    "IE",
    "Tipo comercio",
    "Ubicacion",
    "Atendido por",
    "Tipo venta",
    "Dias boleto",
    "Vencimiento boleto",
    "Estado boleto",
    "Producto",
    "Cantidad (unid)",
    "Valor unitario (R$)",
    "Total linea (R$)",
    "Total visita (R$)",
    "Abono realizado (R$)",
    "Saldo pendiente visita (R$)",
    "Saldo pendiente cliente (R$)",
    "Factura",
    "Proxima visita",
    "Notas visita"
  ];

  const rows = [];
  let totalDeliveredValue = 0;
  let totalCollectedValue = 0;
  let totalPendingVisits = 0;
  for (const visit of visits) {
    const client = clientMap.get(String(visit.clientId)) || {};
    const totalVisit = parseNumber(visit.totalValue ?? visit.soldAmount);
    const collected = parseNumber(visit.amountCollected);
    const pendingVisit = Math.max(0, totalVisit - collected);
    totalDeliveredValue += totalVisit;
    totalCollectedValue += collected;
    totalPendingVisits += pendingVisit;
    const currentDebt = parseNumber(clientDebtMap.get(String(visit.clientId)));
    const managedByName =
      String(client.managedByType || "") === "seller"
        ? sellerMap.get(String(client.managedBySellerId || "")) || "Vendedor externo"
        : "Propietario";

    let boletoStatus = "";
    if (String(visit.saleType || "") === "boleto") {
      if (visit.boletoPaid) boletoStatus = "Pagado";
      else if (visit.dueDate && new Date(`${visit.dueDate}T23:59:59`).getTime() < Date.now()) boletoStatus = "Vencido";
      else boletoStatus = "Pendiente";
    }

    const dateObj = new Date(`${visit.date}T00:00:00`);
    const dayName = dateObj.toLocaleDateString("es-ES", { weekday: "long" });
    const lines = Array.isArray(visit.items) && visit.items.length > 0
      ? visit.items
      : [{
          productName: "N/D",
          quantity: parseNumber(visit.delivered),
          unitPrice: 0,
          total: totalVisit
        }];

    for (const line of lines) {
      rows.push([
        visit.date || "",
        dayName,
        client.internalId || "",
        visit.clientId || "",
        client.tradeName || client.name || "",
        client.buyerName || client.contact || "",
        client.phone || "",
        client.email || "",
        client.cnpj || "",
        client.ie || "",
        client.type || "",
        client.location || "",
        managedByName,
        visit.saleType || visit.paymentType || "",
        visit.saleType === "boleto" ? String(visit.boletoDays || "") : "",
        visit.dueDate || "",
        boletoStatus,
        line.productName || "",
        fmtUnits(line.quantity),
        fmtMoney(line.unitPrice),
        fmtMoney(line.total),
        fmtMoney(totalVisit),
        fmtMoney(collected),
        fmtMoney(pendingVisit),
        fmtMoney(currentDebt),
        visit.invoiceNumber || "",
        visit.nextVisitDate || "",
        String(visit.notes || "")
      ]);
    }
  }

  if (rows.length > 0) {
    rows.push(["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
    rows.push([
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      `Total entregado: ${fmtMoney(totalDeliveredValue)}`,
      "",
      "",
      "",
      ""
    ]);
    rows.push([
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      `Total abonado: ${fmtMoney(totalCollectedValue)}`,
      "",
      "",
      "",
      ""
    ]);
    rows.push([
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      `Total pendiente: ${fmtMoney(totalPendingVisits)}`,
      "",
      "",
      "",
      ""
    ]);
  }

  const csvBody = [headers, ...rows]
    .map((row) => row.map(escapeCsv).join(";"))
    .join("\r\n");

  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename=\"reporte_distribuidora_${ts}.csv\"`);
  return res.status(200).send(`\uFEFF${csvBody}`);
});

function getVisitsWithFilters(data, filters = {}) {
  const from = String(filters.from || "").trim();
  const to = String(filters.to || "").trim();
  const clientId = String(filters.clientId || "").trim();
  const saleType = String(filters.saleType || "all").trim();
  return data.visits
    .filter((visit) => {
      if (from && String(visit.date) < from) return false;
      if (to && String(visit.date) > to) return false;
      if (clientId && String(visit.clientId) !== clientId) return false;
      if (saleType !== "all" && String(visit.saleType || "") !== saleType) return false;
      return true;
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

function calculateWeeklyProductMetrics(visits, clientMap) {
  const byClientProductState = new Map();
  const byClientProductMetrics = new Map();
  const byProductMetrics = new Map();

  for (const visit of visits) {
    const currentDate = new Date(`${visit.date}T00:00:00`);
    const items = Array.isArray(visit.items) ? visit.items : [];
    for (const item of items) {
      const productKey = String(item.productId || item.productName || "").trim().toLowerCase();
      const productName = String(item.productName || "Producto").trim() || "Producto";
      if (!productKey) continue;

      const stateKey = `${visit.clientId}::${productKey}`;
      const prev = byClientProductState.get(stateKey);
      const currentRemaining = item.remaining === null || item.remaining === undefined || String(item.remaining).trim() === ""
        ? null
        : parseNumber(item.remaining);
      const currentDelivered = parseNumber(item.quantity);

      if (prev && currentRemaining !== null) {
        const diffDays = Math.max(1, Math.round((currentDate.getTime() - prev.date.getTime()) / 86400000));
        const soldUnits = Math.max(0, prev.delivered - currentRemaining);
        const metric = byClientProductMetrics.get(stateKey) || {
          clientId: String(visit.clientId),
          clientName: clientMap.get(String(visit.clientId))?.tradeName || clientMap.get(String(visit.clientId))?.name || "Cliente",
          internalId: clientMap.get(String(visit.clientId))?.internalId || "",
          productKey,
          productName,
          soldUnits: 0,
          totalDays: 0,
          transitions: 0
        };
        metric.soldUnits += soldUnits;
        metric.totalDays += diffDays;
        metric.transitions += 1;
        byClientProductMetrics.set(stateKey, metric);
      }

      byClientProductState.set(stateKey, { date: currentDate, delivered: currentDelivered });
    }
  }

  const byClientProduct = [...byClientProductMetrics.values()]
    .map((item) => {
      const weeklyAvg = item.totalDays > 0 ? (item.soldUnits / item.totalDays) * 7 : 0;
      const suggestedQty = Math.max(1, Math.ceil(weeklyAvg));
      const out = { ...item, weeklyAvg, suggestedQty };
      const p = byProductMetrics.get(item.productKey) || { productName: item.productName, soldUnits: 0, totalDays: 0, clients: 0 };
      p.soldUnits += item.soldUnits;
      p.totalDays += item.totalDays;
      p.clients += 1;
      byProductMetrics.set(item.productKey, p);
      return out;
    })
    .sort((a, b) => b.weeklyAvg - a.weeklyAvg);

  const byProduct = [...byProductMetrics.values()]
    .map((item) => {
      const weeklyAvg = item.totalDays > 0 ? (item.soldUnits / item.totalDays) * 7 : 0;
      return { ...item, weeklyAvg, suggestedQty: Math.max(1, Math.ceil(weeklyAvg)) };
    })
    .sort((a, b) => b.weeklyAvg - a.weeklyAvg);

  return { byClientProduct, byProduct };
}

app.get("/api/reports/export-xlsx", async (req, res) => {
  try {
    const data = readDb();
    const { sellers } = ensureDefaultSellers(data);
    const sellerMap = new Map(sellers.map((seller) => [seller.id, seller.name]));
    const clients = data.clients.map(normalizeClient);
    const clientMap = new Map(clients.map((client) => [client.id, client]));
    const clientDebtMap = new Map(clients.map((client) => [client.id, getClientDebt(data.visits, client.id)]));

    const filters = {
      from: req.query.from,
      to: req.query.to,
      clientId: req.query.clientId,
      saleType: req.query.saleType
    };
    const visits = getVisitsWithFilters(data, filters);
    const weeklyMetrics = calculateWeeklyProductMetrics(visits, clientMap);

    let totalDeliveredValue = 0;
    let totalCollectedValue = 0;
    let totalPendingVisits = 0;

    const detailRows = [];
    for (const visit of visits) {
      const client = clientMap.get(String(visit.clientId)) || {};
      const totalVisit = parseNumber(visit.totalValue ?? visit.soldAmount);
      const collected = parseNumber(visit.amountCollected);
      const pendingVisit = Math.max(0, totalVisit - collected);
      totalDeliveredValue += totalVisit;
      totalCollectedValue += collected;
      totalPendingVisits += pendingVisit;

      const managedByName =
        String(client.managedByType || "") === "seller"
          ? sellerMap.get(String(client.managedBySellerId || "")) || "Vendedor externo"
          : "Propietario";

      let boletoStatus = "";
      if (String(visit.saleType || "") === "boleto") {
        if (visit.boletoPaid) boletoStatus = "Pagado";
        else if (visit.dueDate && new Date(`${visit.dueDate}T23:59:59`).getTime() < Date.now()) boletoStatus = "Vencido";
        else boletoStatus = "Pendiente";
      }

      const dateObj = new Date(`${visit.date}T00:00:00`);
      const dayName = dateObj.toLocaleDateString("es-ES", { weekday: "long" });
      const lines = Array.isArray(visit.items) && visit.items.length > 0
        ? visit.items
        : [{
            productName: "N/D",
            quantity: parseNumber(visit.delivered),
            unitPrice: 0,
            total: totalVisit,
            remaining: null
          }];

      for (const line of lines) {
        detailRows.push({
          date: visit.date || "",
          dayName,
          internalId: client.internalId || "",
          clientId: visit.clientId || "",
          tradeName: client.tradeName || client.name || "",
          buyerName: client.buyerName || client.contact || "",
          phone: client.phone || "",
          email: client.email || "",
          cnpj: client.cnpj || "",
          ie: client.ie || "",
          type: client.type || "",
          location: client.location || "",
          managedByName,
          saleType: visit.saleType || visit.paymentType || "",
          boletoDays: visit.saleType === "boleto" ? Number(visit.boletoDays || 0) : "",
          dueDate: visit.dueDate || "",
          boletoStatus,
          productName: line.productName || "",
          quantity: parseNumber(line.quantity),
          unitPrice: parseNumber(line.unitPrice),
          totalLine: parseNumber(line.total),
          totalVisit,
          amountCollected: collected,
          pendingVisit,
          pendingClient: parseNumber(clientDebtMap.get(String(visit.clientId))),
          invoiceNumber: visit.invoiceNumber || "",
          nextVisitDate: visit.nextVisitDate || "",
          notes: String(visit.notes || ""),
          remainingStock: line.remaining === null || line.remaining === undefined ? "" : parseNumber(line.remaining)
        });
      }
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Snack App";
    workbook.created = new Date();

    const summary = workbook.addWorksheet("Resumen");
    summary.columns = [
      { header: "Indicador", key: "label", width: 34 },
      { header: "Valor", key: "value", width: 22 }
    ];
    summary.mergeCells("A1:B1");
    summary.getCell("A1").value = "Reporte de VeDistribuidora";
    summary.getCell("A1").font = { size: 18, bold: true, color: { argb: "FFFFFFFF" } };
    summary.getCell("A1").alignment = { vertical: "middle", horizontal: "left" };
    summary.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF6E3D13" } };
    summary.getRow(1).height = 28;

    summary.addRow({});
    summary.addRow({ label: "Total entregado", value: totalDeliveredValue });
    summary.addRow({ label: "Total abonado", value: totalCollectedValue });
    summary.addRow({ label: "Total pendiente", value: totalPendingVisits });
    for (const rowIndex of [3, 4, 5]) {
      summary.getCell(`A${rowIndex}`).font = { bold: true, color: { argb: "FF3F2F1E" } };
      summary.getCell(`B${rowIndex}`).numFmt = '"R$" #,##0.00';
      summary.getCell(`B${rowIndex}`).font = { bold: true };
      summary.getCell(`A${rowIndex}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4E8D9" } };
      summary.getCell(`B${rowIndex}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4E8D9" } };
      summary.getCell(`A${rowIndex}`).border = { top: { style: "thin", color: { argb: "FFE4D6C3" } }, left: { style: "thin", color: { argb: "FFE4D6C3" } }, bottom: { style: "thin", color: { argb: "FFE4D6C3" } }, right: { style: "thin", color: { argb: "FFE4D6C3" } } };
      summary.getCell(`B${rowIndex}`).border = { top: { style: "thin", color: { argb: "FFE4D6C3" } }, left: { style: "thin", color: { argb: "FFE4D6C3" } }, bottom: { style: "thin", color: { argb: "FFE4D6C3" } }, right: { style: "thin", color: { argb: "FFE4D6C3" } } };
    }

    summary.addRow({});
    summary.addRow({ label: "Filtro desde", value: String(filters.from || "Sin filtro") });
    summary.addRow({ label: "Filtro hasta", value: String(filters.to || "Sin filtro") });
    summary.addRow({
      label: "Filtro cliente",
      value: filters.clientId ? `${String(filters.clientId)} - ${clientMap.get(String(filters.clientId))?.tradeName || clientMap.get(String(filters.clientId))?.name || "Cliente"}` : "Todos"
    });
    summary.addRow({ label: "Filtro tipo venta", value: String(filters.saleType || "all") });

    summary.addRow({});
    summary.addRow({ label: "Promedio semanal por producto (global)" });
    summary.getCell(`A${summary.rowCount}`).font = { bold: true };
    summary.addRow({ label: "Producto", value: "Promedio semanal (unid) / Sugerencia 7d (unid)" });
    summary.getCell(`A${summary.rowCount}`).font = { bold: true };
    summary.getCell(`B${summary.rowCount}`).font = { bold: true };
    for (const metric of weeklyMetrics.byProduct.slice(0, 30)) {
      summary.addRow({
        label: metric.productName,
        value: `${metric.weeklyAvg.toFixed(2)} / ${metric.suggestedQty}`
      });
    }
    if (weeklyMetrics.byProduct.length === 0) {
      summary.addRow({ label: "Sin datos suficientes", value: "Registra 'restante' en la proxima visita para habilitar este calculo." });
    }

    const detail = workbook.addWorksheet("Detalle");
    detail.columns = [
      { header: "Fecha despacho", key: "date", width: 14 },
      { header: "Dia semana", key: "dayName", width: 14 },
      { header: "ID interno", key: "internalId", width: 13 },
      { header: "ID cliente", key: "clientId", width: 16 },
      { header: "Comercio", key: "tradeName", width: 24 },
      { header: "Responsable", key: "buyerName", width: 20 },
      { header: "Telefono", key: "phone", width: 14 },
      { header: "Correo", key: "email", width: 24 },
      { header: "CNPJ", key: "cnpj", width: 18 },
      { header: "IE", key: "ie", width: 14 },
      { header: "Tipo comercio", key: "type", width: 14 },
      { header: "Ubicacion", key: "location", width: 24 },
      { header: "Atendido por", key: "managedByName", width: 16 },
      { header: "Tipo venta", key: "saleType", width: 12 },
      { header: "Dias boleto", key: "boletoDays", width: 11 },
      { header: "Vencimiento boleto", key: "dueDate", width: 16 },
      { header: "Estado boleto", key: "boletoStatus", width: 13 },
      { header: "Producto", key: "productName", width: 16 },
      { header: "Cantidad (unid)", key: "quantity", width: 14 },
      { header: "Valor unitario (R$)", key: "unitPrice", width: 16 },
      { header: "Total linea (R$)", key: "totalLine", width: 15 },
      { header: "Total visita (R$)", key: "totalVisit", width: 15 },
      { header: "Abono realizado (R$)", key: "amountCollected", width: 17 },
      { header: "Saldo pendiente visita (R$)", key: "pendingVisit", width: 22 },
      { header: "Saldo pendiente cliente (R$)", key: "pendingClient", width: 23 },
      { header: "Factura", key: "invoiceNumber", width: 14 },
      { header: "Proxima visita", key: "nextVisitDate", width: 14 },
      { header: "Notas visita", key: "notes", width: 28 },
      { header: "Restante para calculo (unid)", key: "remainingStock", width: 24 }
    ];

    detail.addRows(detailRows);
    detail.autoFilter = { from: "A1", to: "AC1" };
    detail.views = [{ state: "frozen", ySplit: 1 }];
    detail.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    detail.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD96D20" } };

    const moneyCols = ["T", "U", "V", "W", "X", "Y"];
    for (let row = 2; row <= detail.rowCount; row += 1) {
      for (const col of moneyCols) {
        detail.getCell(`${col}${row}`).numFmt = '"R$" #,##0.00';
      }
    }
    for (let row = 2; row <= detail.rowCount; row += 1) {
      detail.getCell(`S${row}`).numFmt = '#,##0.00 "unid"';
      detail.getCell(`AC${row}`).numFmt = '#,##0.00 "unid"';
    }

    // Hide sensitive columns by default; can be unhidden by the user in Excel.
    for (const colIndex of [7, 8, 9, 10, 12]) {
      detail.getColumn(colIndex).hidden = true;
    }

    detail.addRow({});
    const r1 = detail.addRow(["Total entregado (R$)", totalDeliveredValue]);
    const r2 = detail.addRow(["Total abonado (R$)", totalCollectedValue]);
    const r3 = detail.addRow(["Total pendiente (R$)", totalPendingVisits]);
    for (const row of [r1, r2, r3]) {
      row.getCell(1).font = { bold: true };
      row.getCell(2).font = { bold: true };
      row.getCell(2).numFmt = '"R$" #,##0.00';
    }

    const weeklySheet = workbook.addWorksheet("Promedio Semanal");
    weeklySheet.columns = [
      { header: "ID interno", key: "internalId", width: 14 },
      { header: "Cliente", key: "clientName", width: 24 },
      { header: "Producto", key: "productName", width: 20 },
      { header: "Transiciones", key: "transitions", width: 12 },
      { header: "Venta semanal prom (unid)", key: "weeklyAvg", width: 22 },
      { header: "Sugerencia proxima entrega 7d (unid)", key: "suggestedQty", width: 32 },
      { header: "Grafica promedio", key: "weeklyBar", width: 22 },
      { header: "Grafica sugerencia", key: "suggestedBar", width: 22 }
    ];
    weeklySheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    weeklySheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF3B7A57" } };
    weeklySheet.addRows(
      weeklyMetrics.byClientProduct.map((item) => ({
        internalId: item.internalId || "",
        clientName: item.clientName,
        productName: item.productName,
        transitions: item.transitions,
        weeklyAvg: item.weeklyAvg,
        suggestedQty: item.suggestedQty
      }))
    );
    for (let row = 2; row <= weeklySheet.rowCount; row += 1) {
      weeklySheet.getCell(`E${row}`).numFmt = '#,##0.00 "unid"';
      weeklySheet.getCell(`F${row}`).numFmt = '#,##0 "unid"';
      weeklySheet.getCell(`G${row}`).value = { formula: `REPT("█",MAX(1,ROUND(E${row},0)))` };
      weeklySheet.getCell(`H${row}`).value = { formula: `REPT("█",MAX(1,F${row}))` };
      weeklySheet.getCell(`G${row}`).font = { color: { argb: "FF2A6A4C" } };
      weeklySheet.getCell(`H${row}`).font = { color: { argb: "FFD96D20" } };
      if (row % 2 === 0) {
        for (const col of ["A", "B", "C", "D", "E", "F", "G", "H"]) {
          weeklySheet.getCell(`${col}${row}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF6FBF8" } };
        }
      }
    }
    if (weeklySheet.rowCount >= 2) {
      weeklySheet.addConditionalFormatting({
        ref: `E2:E${weeklySheet.rowCount}`,
        rules: [{ type: "dataBar", cfvo: [{ type: "min" }, { type: "max" }], color: "FF4BAA77", showValue: true }]
      });
      weeklySheet.addConditionalFormatting({
        ref: `F2:F${weeklySheet.rowCount}`,
        rules: [{ type: "dataBar", cfvo: [{ type: "min" }, { type: "max" }], color: "FFD96D20", showValue: true }]
      });
    }
    weeklySheet.autoFilter = { from: "A1", to: "H1" };
    weeklySheet.views = [{ state: "frozen", ySplit: 1 }];
    if (weeklyMetrics.byClientProduct.length === 0) {
      weeklySheet.addRow({
        internalId: "",
        clientName: "Sin datos suficientes.",
        productName: "Registra restante en la proxima visita para activar el calculo.",
        transitions: "",
        weeklyAvg: "",
        suggestedQty: ""
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=\"reporte_distribuidora_${ts}.xlsx\"`);
    return res.status(200).send(Buffer.from(buffer));
  } catch (error) {
    return res.status(500).json({ error: `No fue posible generar Excel: ${error.message}` });
  }
});

if (fs.existsSync(webIndexPath)) {
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    return res.sendFile(webIndexPath);
  });
}

app.listen(PORT, () => {
  runAutomaticMaintenance("startup");
  scheduleNightlyMaintenance();
  console.log(`Servidor local activo en http://localhost:${PORT}`);
  console.log(`Base de datos JSON: ${dbPath}`);
  console.log(`Backups JSON: ${backupsDir}`);
});
