import React from "react";
import logoPlatanito from "./assets/logo-platanito.jpg";

const API_BASE = (import.meta.env.VITE_API_URL || "http://localhost:4000/api").replace(/\/$/, "");
const tabs = [["dashboard", "Panel"],["clients", "Clientes"],["visits", "Visitas"],["sales", "Ventas"],["products", "Productos"],["inventory", "Inventario"],["production", "Produccion"],["sellers", "Vendedores"],["reports", "Reportes"]];

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const money = (v) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(num(v));
const date = (v) => (v ? new Date(`${v}T00:00:00`).toLocaleDateString("pt-BR") : "-");
const isThisWeekDate = (dateString) => {
  if (!dateString) return false;
  const d = new Date(`${dateString}T00:00:00`);
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const day = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - day);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return d >= start && d < end;
};
const digits = (v) => String(v || "").replace(/\D/g, "");
const CLIENT_FORM_INITIAL = {
  tradeName: "",
  buyerName: "",
  cep: "",
  addressStreet: "",
  addressNumber: "",
  addressNeighborhood: "",
  addressCity: "",
  addressState: "",
  location: "",
  type: "",
  phone: "",
  email: "",
  cpf: "",
  cnpj: "",
  ie: "",
  observations: "",
  managedByType: "owner",
  managedBySellerId: ""
};

async function apiGet(path) {
  const r = await fetch(`${API_BASE}${path}`);
  const raw = await r.text();
  let j; try { j = JSON.parse(raw); } catch { j = { error: raw || "Respuesta invalida" }; }
  if (!r.ok) throw new Error(j.error || "Error de conexion");
  return j;
}
async function apiPost(path, body) {
  const r = await fetch(`${API_BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const raw = await r.text();
  let j; try { j = JSON.parse(raw); } catch { j = { error: raw || "Respuesta invalida" }; }
  if (!r.ok) throw new Error(j.error || "Error");
  return j;
}
async function apiPut(path, body) {
  const r = await fetch(`${API_BASE}${path}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const raw = await r.text();
  let j; try { j = JSON.parse(raw); } catch { j = { error: raw || "Respuesta invalida" }; }
  if (!r.ok) throw new Error(j.error || "Error");
  return j;
}
async function apiDelete(path) {
  const r = await fetch(`${API_BASE}${path}`, { method: "DELETE" });
  const raw = await r.text();
  let j; try { j = JSON.parse(raw); } catch { j = { error: raw || "Respuesta invalida" }; }
  if (!r.ok) throw new Error(j.error || "Error");
  return j;
}

export default function App() {
  const todayIso = new Date().toISOString().slice(0, 10);
  const [tab, setTab] = React.useState("dashboard");
  const [data, setData] = React.useState({ clients: [], prospects: [], visits: [], products: [], inventory: [], rawMaterials: [], rawMaterialRestocks: [], productionRecipes: [], productionBatches: [], productionSummary: { byProduct: [], requiredMaterials: [], averageUnitCostByProduct: [], totalEstimatedBuyCost: 0 }, sellers: [], sellerOverview: [], dashboard: { totalSoldThisWeek: 0, totalDebt: 0, clientsNeedingVisit: [], topClients: [] } });
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [ok, setOk] = React.useState("");
  const [savingClient, setSavingClient] = React.useState(false);
  const [loadingCep, setLoadingCep] = React.useState(false);
  const [loadingCnpj, setLoadingCnpj] = React.useState(false);
  const [showClientModal, setShowClientModal] = React.useState(false);
  const [showWeekDetails, setShowWeekDetails] = React.useState(false);
  const [showDebtDetails, setShowDebtDetails] = React.useState(false);
  const [backupBusy, setBackupBusy] = React.useState(false);
  const [lastBackupFile, setLastBackupFile] = React.useState("");
  const [salesFilters, setSalesFilters] = React.useState({ date: todayIso, clientId: "", sellerId: "", saleType: "all" });
  const [clientEditId, setClientEditId] = React.useState("");
  const [clientEditForm, setClientEditForm] = React.useState(null);

  const [clientForm, setClientForm] = React.useState(CLIENT_FORM_INITIAL);
  const [visitForm, setVisitForm] = React.useState({ date: new Date().toISOString().slice(0, 10), visitType: "dispatch", clientId: "", prospectTradeName: "", prospectBuyerName: "", prospectPhone: "", saleType: "consignado", amountCollected: "0", nextVisitDate: "", notes: "", productId: "", quantity: "", unitPrice: "", remaining: "" });
  const [productForm, setProductForm] = React.useState({ name: "", unitPrice: "", ownProduction: false });
  const [inventoryForm, setInventoryForm] = React.useState({ productId: "", quantity: "" });
  const [inventoryDraft, setInventoryDraft] = React.useState({});
  const [transferForm, setTransferForm] = React.useState({ sellerId: "", productId: "", quantity: "" });
  const [rawMaterialForm, setRawMaterialForm] = React.useState({ name: "", unit: "kg", stockQty: "", costPerUnit: "", appliesToProductIds: [] });
  const [rawMaterialProductDraft, setRawMaterialProductDraft] = React.useState("");
  const [restockForm, setRestockForm] = React.useState({ materialId: "", qtyAdded: "", unitCost: "", date: todayIso, supplier: "", notes: "" });
  const [productionProductId, setProductionProductId] = React.useState("");
  const [productionOpen, setProductionOpen] = React.useState({ raw: false, recipe: false, cost: false, batch: false });
  const [recipeForm, setRecipeForm] = React.useState({ productId: "", yieldQty: "" });
  const [recipeComponentDraft, setRecipeComponentDraft] = React.useState({ materialId: "", qty: "" });
  const [recipeComponents, setRecipeComponents] = React.useState([]);
  const [batchForm, setBatchForm] = React.useState({ date: new Date().toISOString().slice(0, 10), productId: "", outputQty: "", notes: "" });
  const sellers = React.useMemo(() => (data.sellers || []).filter((s) => s.role === "seller" && s.active), [data.sellers]);
  const selectedProductRecipe = React.useMemo(() => {
    const productId = String(recipeForm.productId || "");
    if (!productId) return null;
    return (data.productionRecipes || []).find((recipe) => String(recipe.productId || "") === productId) || null;
  }, [data.productionRecipes, recipeForm.productId]);
  const ownProductionProducts = React.useMemo(
    () => (data.products || []).filter((row) => row.active !== false && row.ownProduction === true),
    [data.products]
  );
  const selectedProductionProduct = React.useMemo(
    () => ownProductionProducts.find((row) => row.id === productionProductId) || null,
    [ownProductionProducts, productionProductId]
  );
  const selectedProductionSummary = React.useMemo(
    () => (data.productionSummary?.byProduct || []).find((row) => String(row.productId || "") === String(productionProductId || "")) || null,
    [data.productionSummary, productionProductId]
  );

  async function loadAll() {
    try {
      setLoading(true); setError("");
      const payload = await apiGet("/data");
      setData({
        ...payload,
        prospects: Array.isArray(payload?.prospects) ? payload.prospects : []
      });
    } catch (e) { setError(e.message || "No se pudo cargar"); }
    finally { setLoading(false); }
  }
  React.useEffect(() => { loadAll(); }, []);
  React.useEffect(() => { if (!ok) return; const t = setTimeout(() => setOk(""), 1800); return () => clearTimeout(t); }, [ok]);

  const weekSummary = React.useMemo(() => {
    const weekVisits = (data.visits || []).filter((visit) => isThisWeekDate(visit.date));
    const byProduct = new Map();
    let totalValue = 0;
    let totalVista = 0;
    let totalConsignado = 0;
    for (const visit of weekVisits) {
      const visitTotal = num(visit.totalValue ?? visit.soldAmount);
      totalValue += visitTotal;
      const saleType = String(visit.saleType || visit.paymentType || "").toLowerCase();
      if (saleType === "a_vista") totalVista += visitTotal;
      if (saleType === "consignado") totalConsignado += visitTotal;
      const items = Array.isArray(visit.items) ? visit.items : [];
      for (const item of items) {
        const productName = String(item.productName || "Sin producto").trim() || "Sin producto";
        const current = byProduct.get(productName) || { productName, qty: 0, value: 0 };
        current.qty += num(item.quantity);
        current.value += num(item.total || (num(item.quantity) * num(item.unitPrice)));
        byProduct.set(productName, current);
      }
    }
    return {
      totalValue,
      totalVista,
      totalConsignado,
      products: [...byProduct.values()].sort((a, b) => b.value - a.value)
    };
  }, [data.visits]);

  const debtSummary = React.useMemo(() => {
    const debtByClient = (data.clients || [])
      .map((client) => ({
        clientId: client.id,
        clientName: client.tradeName || client.name || "Cliente",
        debt: num(client.debt)
      }))
      .filter((row) => row.debt > 0)
      .sort((a, b) => b.debt - a.debt);
    const byProduct = new Map();
    for (const visit of data.visits || []) {
      const saleType = String(visit.saleType || "").toLowerCase();
      const paidBoleto = saleType === "boleto" && !!visit.boletoPaid;
      const visitTotal = num(visit.totalValue ?? visit.soldAmount);
      const pending = Math.max(0, paidBoleto ? 0 : (visitTotal - num(visit.amountCollected)));
      if (pending <= 0) continue;
      const items = Array.isArray(visit.items) ? visit.items : [];
      if (!items.length) {
        byProduct.set("Sin detalle", (byProduct.get("Sin detalle") || 0) + pending);
        continue;
      }
      const itemsTotal = items.reduce((acc, item) => acc + num(item.total || (num(item.quantity) * num(item.unitPrice))), 0);
      if (itemsTotal <= 0) {
        byProduct.set("Sin detalle", (byProduct.get("Sin detalle") || 0) + pending);
        continue;
      }
      for (const item of items) {
        const productName = String(item.productName || "Sin producto").trim() || "Sin producto";
        const itemTotal = num(item.total || (num(item.quantity) * num(item.unitPrice)));
        byProduct.set(productName, (byProduct.get(productName) || 0) + (pending * (itemTotal / itemsTotal)));
      }
    }
    return {
      debtByClient,
      debtByProduct: [...byProduct.entries()]
        .map(([productName, debt]) => ({ productName, debt }))
        .filter((row) => row.debt > 0)
        .sort((a, b) => b.debt - a.debt)
    };
  }, [data.clients, data.visits]);

  const salesRows = React.useMemo(() => {
    return (data.visits || [])
      .map((visit) => {
        const saleType = String(visit.saleType || visit.paymentType || "").toLowerCase();
        if (String(visit.visitType || "").toLowerCase() === "count_only") return null;
        if (saleType === "degustacion") return null;
        const client = (data.clients || []).find((c) => c.id === visit.clientId);
        const seller = (data.sellers || []).find((s) => s.id === visit.createdBySellerId);
        const totalValue = num(visit.totalValue ?? visit.soldAmount);
        const collected = num(visit.amountCollected);
        const pending = Math.max(0, totalValue - collected);
        return {
          ...visit,
          saleType: saleType || "consignado",
          clientName: client?.tradeName || client?.name || visit.prospectTradeName || "Prospecto",
          sellerName: visit.createdBySellerName || (visit.createdBySellerId ? (seller?.name || "Vendedor") : "Admin"),
          totalValue,
          collected,
          pending
        };
      })
      .filter(Boolean)
      .filter((row) => {
        if (salesFilters.date && String(row.date) !== String(salesFilters.date)) return false;
        if (salesFilters.clientId && String(row.clientId) !== String(salesFilters.clientId)) return false;
        if (salesFilters.sellerId === "admin" && row.createdBySellerId) return false;
        if (salesFilters.sellerId && salesFilters.sellerId !== "admin" && String(row.createdBySellerId || "") !== String(salesFilters.sellerId)) return false;
        if (salesFilters.saleType !== "all" && String(row.saleType) !== String(salesFilters.saleType)) return false;
        return true;
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [data.visits, data.clients, data.sellers, salesFilters]);

  const salesSummary = React.useMemo(() => ({
    totalValue: salesRows.reduce((acc, row) => acc + num(row.totalValue), 0),
    totalCollected: salesRows.reduce((acc, row) => acc + num(row.collected), 0),
    totalPending: salesRows.reduce((acc, row) => acc + num(row.pending), 0)
  }), [salesRows]);

  const degustationSummary = React.useMemo(() => {
    const prospectsById = new Map((data.prospects || []).map((p) => [String(p.id), p]));
    const clientsById = new Map((data.clients || []).map((c) => [String(c.id), c]));
    const degustations = (data.visits || [])
      .filter((v) => String(v.visitType || "").toLowerCase() === "degustacion")
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    const uniqueProspects = new Set(degustations.map((v) => String(v.prospectId || "").trim()).filter(Boolean));
    let converted = 0;
    for (const id of uniqueProspects) {
      const prospect = prospectsById.get(id);
      if (prospect?.convertedClientId) converted += 1;
    }
    const conversionRate = uniqueProspects.size > 0 ? (converted / uniqueProspects.size) * 100 : 0;
    return {
      totalDegustations: degustations.length,
      uniqueProspects: uniqueProspects.size,
      converted,
      conversionRate,
      latest: degustations.slice(0, 20).map((v) => {
        const prospect = prospectsById.get(String(v.prospectId || ""));
        const client = prospect?.convertedClientId ? clientsById.get(String(prospect.convertedClientId)) : null;
        return {
          id: v.id,
          date: v.date,
          prospectName: v.prospectTradeName || prospect?.tradeName || (client ? (client.tradeName || client.name) : "Prospecto"),
          status: client ? "Convertido" : "Pendiente",
          convertedClientName: client ? (client.tradeName || client.name || "") : ""
        };
      })
    };
  }, [data.visits, data.prospects, data.clients]);

  function openClientModal() {
    setClientForm({ ...CLIENT_FORM_INITIAL });
    setShowClientModal(true);
  }

  function closeClientModal() {
    setClientForm({ ...CLIENT_FORM_INITIAL });
    setShowClientModal(false);
  }

  function updateClientForm(upd) {
    setClientForm((prev) => {
      const next = { ...prev, ...upd };
      next.location = [next.addressStreet, next.addressNumber, next.addressNeighborhood, next.addressCity, next.addressState].filter(Boolean).join(", ");
      return next;
    });
  }

  async function lookupCep() {
    const cep = digits(clientForm.cep);
    if (cep.length !== 8) return setError("CEP invalido");
    try {
      setLoadingCep(true);
      setError("");
      const d = await apiGet(`/lookup/cep/${cep}`);
      updateClientForm({
        cep: d.cep || cep,
        addressStreet: d.street || clientForm.addressStreet,
        addressNeighborhood: d.neighborhood || clientForm.addressNeighborhood,
        addressCity: d.city || clientForm.addressCity,
        addressState: d.state || clientForm.addressState
      });
    } catch (e) {
      setError(e.message || "Error CEP");
    } finally {
      setLoadingCep(false);
    }
  }

  async function lookupCnpj() {
    const cnpj = digits(clientForm.cnpj);
    if (cnpj.length !== 14) return setError("CNPJ invalido");
    try {
      setLoadingCnpj(true);
      setError("");
      const d = await apiGet(`/lookup/cnpj/${cnpj}`);
      updateClientForm({
        cnpj,
        tradeName: d.tradeName || clientForm.tradeName,
        email: d.email || clientForm.email,
        phone: d.phone || clientForm.phone,
        ie: d.ie || clientForm.ie,
        cep: d.cep || clientForm.cep,
        addressStreet: d.street || clientForm.addressStreet,
        addressNumber: d.number || clientForm.addressNumber,
        addressNeighborhood: d.neighborhood || clientForm.addressNeighborhood,
        addressCity: d.city || clientForm.addressCity,
        addressState: d.state || clientForm.addressState
      });
    } catch (e) {
      setError(e.message || "Error CNPJ");
    } finally {
      setLoadingCnpj(false);
    }
  }

  async function saveClient(e) {
    e.preventDefault();
    if (savingClient) return;
    if (!clientForm.tradeName.trim()) return setError("Nombre comercio obligatorio");
    if (clientForm.managedByType === "seller" && !clientForm.managedBySellerId) return setError("Selecciona vendedor");
    try {
      setSavingClient(true);
      await apiPost("/clients", clientForm);
      closeClientModal();
      setOk("Cliente guardado");
      await loadAll();
      setTab("clients");
    } catch (err) { setError(err.message || "Error"); }
    finally { setSavingClient(false); }
  }

  function beginEditClient(client) {
    setClientEditId(client.id);
    setClientEditForm({
      tradeName: client.tradeName || client.name || "",
      buyerName: client.buyerName || client.contact || "",
      location: client.location || "",
      type: client.type || "",
      phone: client.phone || "",
      email: client.email || "",
      cpf: client.cpf || "",
      cnpj: client.cnpj || "",
      managedByType: client.managedByType || "owner",
      managedBySellerId: client.managedBySellerId || ""
    });
  }

  function cancelEditClient() {
    setClientEditId("");
    setClientEditForm(null);
  }

  async function saveClientEdit(e) {
    e.preventDefault();
    if (!clientEditId || !clientEditForm) return;
    if (!String(clientEditForm.tradeName || "").trim()) return setError("Nombre comercio obligatorio");
    try {
      await apiPut(`/clients/${clientEditId}`, clientEditForm);
      setOk("Cliente actualizado");
      cancelEditClient();
      await loadAll();
    } catch (err) {
      setError(err.message || "Error");
    }
  }

  async function removeClient(client) {
    if (!client?.id) return;
    const confirmed = window.confirm(`Eliminar cliente "${client.tradeName || client.name}"?`);
    if (!confirmed) return;
    try {
      await apiDelete(`/clients/${client.id}`);
      if (clientEditId === client.id) {
        cancelEditClient();
      }
      setOk("Cliente eliminado");
      await loadAll();
    } catch (err) {
      setError(err.message || "Error");
    }
  }

  async function saveVisit(e) {
    e.preventDefault();
    const product = data.products.find((p) => p.id === visitForm.productId);
    const isCountOnly = String(visitForm.visitType || "dispatch") === "count_only";
    const isDegustation = String(visitForm.visitType || "dispatch") === "degustacion";
    if (!product) return setError("Producto obligatorio");
    if (!isDegustation && !visitForm.clientId) return setError("Cliente obligatorio");
    if (isDegustation && !visitForm.clientId && !String(visitForm.prospectTradeName || "").trim()) return setError("En degustacion, selecciona cliente o indica nombre del comercio prospecto.");
    if (!isDegustation && String(visitForm.remaining).trim() === "") return setError("Restante obligatorio");
    const qty = num(visitForm.quantity);
    if (qty <= 0) return setError("Cantidad debe ser mayor a 0");
    const price = isDegustation ? 0 : num(visitForm.unitPrice || product.unitPrice);
    const saleType = isDegustation ? "degustacion" : visitForm.saleType;
    const amountCollected = isDegustation ? 0 : num(visitForm.amountCollected);
    const paymentType = isDegustation ? "degustacion" : (saleType === "a_vista" ? "contado" : "consignado");
    try {
      await apiPost("/visits", {
        visitType: visitForm.visitType,
        clientId: visitForm.clientId,
        prospectTradeName: String(visitForm.prospectTradeName || "").trim(),
        prospectBuyerName: String(visitForm.prospectBuyerName || "").trim(),
        prospectPhone: String(visitForm.prospectPhone || "").trim(),
        date: visitForm.date,
        saleType,
        amountCollected,
        nextVisitDate: visitForm.nextVisitDate,
        notes: visitForm.notes,
        paymentType,
        items: [{ productId: product.id, productName: product.name, quantity: qty, unitPrice: price, total: qty * price, remaining: isDegustation ? null : num(visitForm.remaining) }],
        delivered: qty,
        remaining: 0
      });
      setVisitForm({ date: new Date().toISOString().slice(0, 10), visitType: "dispatch", clientId: "", prospectTradeName: "", prospectBuyerName: "", prospectPhone: "", saleType: "consignado", amountCollected: "0", nextVisitDate: "", notes: "", productId: "", quantity: "", unitPrice: "", remaining: "" });
      setOk("Visita guardada");
      await loadAll();
      setTab("visits");
    } catch (err) { setError(err.message || "Error"); }
  }

  async function saveProduct(e) {
    e.preventDefault();
    try {
      await apiPost("/products", { name: productForm.name, unitPrice: num(productForm.unitPrice), ownProduction: productForm.ownProduction === true, active: true });
      setProductForm({ name: "", unitPrice: "", ownProduction: false });
      setOk("Producto guardado");
      await loadAll();
    } catch (err) { setError(err.message || "Error"); }
  }

  async function toggleOwnProduction(product) {
    try {
      await apiPut(`/products/${product.id}`, { ownProduction: !(product.ownProduction === true) });
      await loadAll();
      setOk("Producto actualizado");
    } catch (err) {
      setError(err.message || "Error");
    }
  }

  async function saveInventory(e) {
    e.preventDefault();
    const product = data.products.find((p) => p.id === inventoryForm.productId);
    if (!product) return;
    try {
      await apiPost("/inventory", { productId: product.id, productName: product.name, quantity: num(inventoryForm.quantity) });
      setInventoryForm({ productId: "", quantity: "" });
      setOk("Inventario actualizado");
      await loadAll();
    } catch (err) { setError(err.message || "Error"); }
  }

  async function transferInventory(e) {
    e.preventDefault();
    try {
      await apiPost("/inventory/transfer", { sellerId: transferForm.sellerId, productId: transferForm.productId, quantity: num(transferForm.quantity) });
      setTransferForm({ sellerId: "", productId: "", quantity: "" });
      setOk("Transferencia realizada");
      await loadAll();
    } catch (err) { setError(err.message || "Error"); }
  }

  async function saveInventoryRow(item) {
    try {
      const qty = num(inventoryDraft[item.id] ?? item.quantity);
      await apiPost("/inventory", { productId: item.productId, productName: item.productName, quantity: qty });
      setOk("Cantidad actualizada");
      await loadAll();
    } catch (err) {
      setError(err.message || "Error");
    }
  }

  function addRecipeComponent() {
    const material = (data.rawMaterials || []).find((row) => row.id === recipeComponentDraft.materialId);
    const qty = num(recipeComponentDraft.qty);
    if (!material || qty <= 0) {
      setError("Selecciona materia prima y cantidad.");
      return;
    }
    setRecipeComponents((prev) => {
      const current = prev.find((row) => row.materialId === material.id);
      if (current) {
        return prev.map((row) => row.materialId === material.id ? { ...row, qty: num(row.qty) + qty } : row);
      }
      return [...prev, { materialId: material.id, materialName: material.name, qty }];
    });
    setRecipeComponentDraft({ materialId: "", qty: "" });
  }

  function removeRecipeComponent(materialId) {
    setRecipeComponents((prev) => prev.filter((row) => row.materialId !== materialId));
  }

  function addRawMaterialProductAssociation() {
    const productId = String(rawMaterialProductDraft || "").trim();
    if (!productId) return;
    setRawMaterialForm((prev) => {
      const current = Array.isArray(prev.appliesToProductIds) ? prev.appliesToProductIds : [];
      if (current.includes(productId)) return prev;
      return { ...prev, appliesToProductIds: [...current, productId] };
    });
    setRawMaterialProductDraft("");
  }

  function removeRawMaterialProductAssociation(productId) {
    setRawMaterialForm((prev) => ({
      ...prev,
      appliesToProductIds: (Array.isArray(prev.appliesToProductIds) ? prev.appliesToProductIds : []).filter((id) => id !== productId)
    }));
  }

  async function saveRawMaterial(e) {
    e.preventDefault();
    if (!String(rawMaterialForm.name || "").trim()) return setError("Nombre de materia prima obligatorio.");
    try {
      await apiPost("/production/raw-materials", {
        name: rawMaterialForm.name,
        unit: rawMaterialForm.unit || "kg",
        stockQty: num(rawMaterialForm.stockQty),
        costPerUnit: num(rawMaterialForm.costPerUnit),
        appliesToProductIds: Array.isArray(rawMaterialForm.appliesToProductIds) ? rawMaterialForm.appliesToProductIds : []
      });
      setRawMaterialForm({ name: "", unit: "kg", stockQty: "", costPerUnit: "", appliesToProductIds: [] });
      setRawMaterialProductDraft("");
      setOk("Materia prima guardada");
      await loadAll();
    } catch (err) {
      setError(err.message || "Error");
    }
  }

  async function saveRawMaterialRestock(e) {
    e.preventDefault();
    if (!restockForm.materialId) return setError("Selecciona materia prima.");
    if (num(restockForm.qtyAdded) <= 0) return setError("La cantidad debe ser mayor a 0.");
    try {
      await apiPost(`/production/raw-materials/${restockForm.materialId}/restock`, {
        qtyAdded: num(restockForm.qtyAdded),
        unitCost: num(restockForm.unitCost),
        date: restockForm.date,
        supplier: restockForm.supplier,
        notes: restockForm.notes
      });
      setRestockForm({ materialId: "", qtyAdded: "", unitCost: "", date: todayIso, supplier: "", notes: "" });
      setOk("Recarga registrada");
      await loadAll();
    } catch (err) {
      setError(err.message || "Error");
    }
  }

  async function saveRecipe(e) {
    e.preventDefault();
    const product = (data.products || []).find((row) => row.id === recipeForm.productId);
    if (!product) return setError("Producto obligatorio.");
    if (num(recipeForm.yieldQty) <= 0) return setError("Rendimiento debe ser mayor a 0.");
    if (recipeComponents.length === 0) return setError("Agrega al menos una materia prima.");
    try {
      await apiPost("/production/recipes", {
        productId: product.id,
        productName: product.name,
        yieldQty: num(recipeForm.yieldQty),
        components: recipeComponents.map((row) => ({ materialId: row.materialId, materialName: row.materialName, qty: num(row.qty) }))
      });
      setRecipeForm({ productId: "", yieldQty: "" });
      setRecipeComponents([]);
      setOk("Receta guardada");
      await loadAll();
    } catch (err) {
      setError(err.message || "Error");
    }
  }

  async function saveBatch(e) {
    e.preventDefault();
    const product = (data.products || []).find((row) => row.id === batchForm.productId);
    if (!product) return setError("Producto obligatorio.");
    if (num(batchForm.outputQty) <= 0) return setError("Cantidad producida debe ser mayor a 0.");
    try {
      await apiPost("/production/batches", {
        date: batchForm.date,
        productId: product.id,
        productName: product.name,
        outputQty: num(batchForm.outputQty),
        notes: batchForm.notes
      });
      setBatchForm({ date: new Date().toISOString().slice(0, 10), productId: "", outputQty: "", notes: "" });
      setOk("Lote de produccion guardado");
      await loadAll();
    } catch (err) {
      setError(err.message || "Error");
    }
  }

  async function markPaid(id) {
    try { await apiPost(`/visits/${id}/mark-paid`, {}); setOk("Pago marcado"); await loadAll(); }
    catch (err) { setError(err.message || "Error"); }
  }

  async function createServerBackup() {
    if (backupBusy) return;
    try {
      setBackupBusy(true);
      const result = await apiPost("/system/backup", {});
      setLastBackupFile(String(result.fileName || ""));
      setOk(`Respaldo creado: ${result.fileName || "ok"}`);
    } catch (err) {
      setError(err.message || "No se pudo crear respaldo");
    } finally {
      setBackupBusy(false);
    }
  }

  async function removeVisit(visit) {
    const clientName = visit?.clientName || "este cliente";
    const confirmed = window.confirm(`Eliminar visita de "${clientName}" (${visit?.date || "-"})?`);
    if (!confirmed) return;
    try {
      await apiDelete(`/visits/${visit.id}`);
      setOk("Visita eliminada");
      await loadAll();
    } catch (err) {
      setError(err.message || "Error");
    }
  }

  const reportUrl = `${API_BASE}/reports/export-xlsx`;
  const dbExportUrl = `${API_BASE}/system/db-export`;

  return (
    <main className="app-shell">
      <header className="hero">
        <div className="heroTop">
          <img src={logoPlatanito} alt="Logo" className="heroLogo" />
          <div><p>Control de Distribuidora</p><h1>Snack App Admin</h1></div>
        </div>
        <div className="actions"><button className="primary" type="button" onClick={() => setTab("newVisit")}>Agregar visita</button><button className="secondary" type="button" onClick={openClientModal}>Agregar cliente</button></div>
      </header>

      <nav className="tabs">{tabs.map(([id, label]) => <button key={id} type="button" className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>)}</nav>

      {error ? <section className="panel"><p className="empty">{error}</p></section> : null}
      {ok ? <section className="panel"><p className="ok">{ok}</p></section> : null}
      {loading ? <section className="panel"><p className="empty">Cargando...</p></section> : null}

      {!loading && tab === "dashboard" && <section className="stack"><div className="cards-grid"><article className="stat-card warm"><div className="dashHead"><span>Vendido esta semana</span><button className="linkBtn" type="button" onClick={() => setShowWeekDetails((p) => !p)}>{showWeekDetails ? "Ocultar" : "Ver detalle"}</button></div><strong>{money(weekSummary.totalValue)}</strong><small>A vista: {money(weekSummary.totalVista)} | Consignado: {money(weekSummary.totalConsignado)}</small>{showWeekDetails ? <div className="dashDetail">{weekSummary.products.length === 0 ? <p className="preview">Sin ventas esta semana.</p> : weekSummary.products.map((item) => <div className="dashRow" key={`week_${item.productName}`}><span>{item.productName}</span><strong>{num(item.qty).toFixed(2)} unid | {money(item.value)}</strong></div>)}</div> : null}</article><article className="stat-card cool"><div className="dashHead"><span>Deuda total</span><button className="linkBtn" type="button" onClick={() => setShowDebtDetails((p) => !p)}>{showDebtDetails ? "Ocultar" : "Ver detalle"}</button></div><strong>{money(data.dashboard.totalDebt)}</strong><small>Clientes con deuda: {debtSummary.debtByClient.length}</small>{showDebtDetails ? <div className="dashDetail"><p className="preview"><strong>Deuda por producto</strong></p>{debtSummary.debtByProduct.length === 0 ? <p className="preview">Sin deuda por producto.</p> : debtSummary.debtByProduct.map((row) => <div className="dashRow" key={`debt_prod_${row.productName}`}><span>{row.productName}</span><strong>{money(row.debt)}</strong></div>)}<p className="preview"><strong>Deuda por cliente</strong></p>{debtSummary.debtByClient.length === 0 ? <p className="preview">Sin deuda por cliente.</p> : debtSummary.debtByClient.map((row) => <div className="dashRow" key={`debt_client_${row.clientId}`}><span>{row.clientName}</span><strong>{money(row.debt)}</strong></div>)}</div> : null}</article><article className="stat-card mint"><span>Clientes por visitar</span><strong>{(data.dashboard.clientsNeedingVisit || []).length}</strong></article></div><article className="panel"><h3>Clientes con mayores ventas</h3><ul className="simple-list">{(data.dashboard.topClients || []).map((c) => <li key={c.id}><span>{c.name}</span><strong>{num(c.totalSold).toFixed(2)} unid</strong></li>)}</ul></article></section>}

      {!loading && tab === "clients" && <section className="panel"><h3>Clientes</h3><ul className="simple-list">{(data.clients || []).map((c) => <li key={c.id}><div><span>{c.tradeName || c.name}</span><small>{c.type || "-"} | {c.location || "Sin ubicacion"}</small><small>Responsable: {c.buyerName || c.contact || "-"}</small><small>Atendido por: {c.managedByName || "Propietario"}</small><small>CPF/CNPJ: {c.cpf || "-"} / {c.cnpj || "-"}</small>{clientEditId === c.id && clientEditForm ? <form className="form inlineForm" onSubmit={saveClientEdit}><label>Nombre comercio<input required value={clientEditForm.tradeName} onChange={(e) => setClientEditForm((d) => ({ ...(d || {}), tradeName: e.target.value }))} /></label><label>Responsable<input value={clientEditForm.buyerName} onChange={(e) => setClientEditForm((d) => ({ ...(d || {}), buyerName: e.target.value }))} /></label><label>Ubicacion<input value={clientEditForm.location} onChange={(e) => setClientEditForm((d) => ({ ...(d || {}), location: e.target.value }))} /></label><label>Tipo<input value={clientEditForm.type} onChange={(e) => setClientEditForm((d) => ({ ...(d || {}), type: e.target.value }))} /></label><label>Telefono<input value={clientEditForm.phone} onChange={(e) => setClientEditForm((d) => ({ ...(d || {}), phone: e.target.value }))} /></label><label>Email<input value={clientEditForm.email} onChange={(e) => setClientEditForm((d) => ({ ...(d || {}), email: e.target.value }))} /></label><label>CPF<input value={clientEditForm.cpf || ""} onChange={(e) => setClientEditForm((d) => ({ ...(d || {}), cpf: e.target.value }))} /></label><label>CNPJ<input value={clientEditForm.cnpj || ""} onChange={(e) => setClientEditForm((d) => ({ ...(d || {}), cnpj: e.target.value }))} /></label><div className="miniActions"><button className="secondary btnMini" type="submit">Guardar cambios</button><button className="btnMini" type="button" onClick={cancelEditClient}>Cancelar</button></div></form> : null}</div><div className="rightCol"><strong>{money(c.debt)}</strong><div className="miniActions"><button className="secondary btnMini" type="button" onClick={() => beginEditClient(c)}>Editar</button><button className="danger btnMini" type="button" onClick={() => removeClient(c)}>Eliminar</button></div></div></li>)}</ul></section>}

      {!loading && tab === "visits" && <section className="panel"><h3>Visitas</h3><ul className="simple-list">{[...(data.visits || [])].sort((a, b) => new Date(b.date) - new Date(a.date)).map((v) => { const c = data.clients.find((x) => x.id === v.clientId); const s = data.sellers.find((x) => x.id === v.createdBySellerId); const saleType = String(v.saleType || v.paymentType || "").toLowerCase(); const visitTotal = num(v.totalValue ?? v.soldAmount); const pending = Math.max(0, visitTotal - num(v.amountCollected)); const canMarkPaid = (saleType === "boleto" || saleType === "consignado") && pending > 0; const visitName = c?.tradeName || c?.name || v.prospectTradeName || "Prospecto"; const visitRow = { ...v, clientName: visitName }; return <li key={v.id}><div><span>{visitName}</span><small>{date(v.date)} | {v.visitType || "dispatch"} | {v.saleType || v.paymentType}</small>{v.prospectTradeName && !v.clientId ? <small>Prospecto: {v.prospectTradeName}{v.prospectBuyerName ? ` | Resp: ${v.prospectBuyerName}` : ""}</small> : null}<small>Registrado por: {v.createdBySellerName || (v.createdBySellerId ? (s?.name || "Vendedor") : "Admin")}</small><small>Total: {money(v.totalValue ?? v.soldAmount)} | Cobrado: {money(v.amountCollected)}</small></div><div className="rightCol"><div className="miniActions">{canMarkPaid ? <button className="secondary btnMini" type="button" onClick={() => markPaid(v.id)}>Marcar pagado</button> : null}<button className="danger btnMini" type="button" onClick={() => removeVisit(visitRow)}>Eliminar</button></div><strong>{money(v.amountCollected)}</strong></div></li>; })}</ul></section>}

      {!loading && tab === "sales" && <section className="stack"><article className="panel"><h3>Ventas</h3><div className="form inlineForm"><label>Fecha<input type="date" value={salesFilters.date} onChange={(e) => setSalesFilters((d) => ({ ...d, date: e.target.value }))} /></label><label>Cliente<select value={salesFilters.clientId} onChange={(e) => setSalesFilters((d) => ({ ...d, clientId: e.target.value }))}><option value="">Todos</option>{(data.clients || []).map((c) => <option key={c.id} value={c.id}>{c.tradeName || c.name}</option>)}</select></label><label>Vendedor<select value={salesFilters.sellerId} onChange={(e) => setSalesFilters((d) => ({ ...d, sellerId: e.target.value }))}><option value="">Todos</option><option value="admin">Admin</option>{(data.sellers || []).filter((s) => s.role === "seller" && s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label>Tipo<select value={salesFilters.saleType} onChange={(e) => setSalesFilters((d) => ({ ...d, saleType: e.target.value }))}><option value="all">Todos</option><option value="a_vista">A vista</option><option value="consignado">Consignado</option><option value="boleto">Boleto</option></select></label><div className="miniActions"><button className="btnMini" type="button" onClick={() => setSalesFilters({ date: todayIso, clientId: "", sellerId: "", saleType: "all" })}>Hoy</button><button className="btnMini" type="button" onClick={() => setSalesFilters({ date: "", clientId: "", sellerId: "", saleType: "all" })}>Limpiar</button></div></div><div className="cards-grid"><article className="stat-card warm"><span>Vendido</span><strong>{money(salesSummary.totalValue)}</strong></article><article className="stat-card cool"><span>Cobrado</span><strong>{money(salesSummary.totalCollected)}</strong></article><article className="stat-card mint"><span>Pendiente</span><strong>{money(salesSummary.totalPending)}</strong></article></div></article><article className="panel"><h3>Detalle de ventas</h3><ul className="simple-list">{salesRows.map((row) => <li key={row.id}><div><span>{row.clientName}</span><small>{date(row.date)} | {row.saleType}</small><small>Vendedor: {row.sellerName}</small></div><div className="rightCol"><small>Total: {money(row.totalValue)}</small><small>Cobrado: {money(row.collected)}</small><strong>Pendiente: {money(row.pending)}</strong></div></li>)}</ul>{salesRows.length === 0 ? <p className="preview">Sin ventas para este filtro.</p> : null}</article></section>}

      {!loading && tab === "products" && <section className="stack"><article className="panel"><h3>Productos</h3><ul className="simple-list">{(data.products || []).map((p) => <li key={p.id}><div><span>{p.name}</span><small>{p.ownProduction ? "Produccion propia: Si" : "Produccion propia: No"}</small></div><div className="miniActions"><strong>{money(p.unitPrice)}</strong><button className="secondary btnMini" type="button" onClick={() => toggleOwnProduction(p)}>{p.ownProduction ? "Quitar propia" : "Marcar propia"}</button></div></li>)}</ul></article><article className="panel form-panel"><h3>Nuevo producto</h3><form className="form" onSubmit={saveProduct}><label>Nombre<input required value={productForm.name} onChange={(e) => setProductForm((d) => ({ ...d, name: e.target.value }))} /></label><label>Valor unitario<input type="number" min="0" step="0.01" value={productForm.unitPrice} onChange={(e) => setProductForm((d) => ({ ...d, unitPrice: e.target.value }))} /></label><label className="checkRow"><input type="checkbox" checked={productForm.ownProduction === true} onChange={(e) => setProductForm((d) => ({ ...d, ownProduction: e.target.checked }))} /> Produccion propia</label><button className="primary full" type="submit">Guardar producto</button></form></article></section>}

      {!loading && tab === "inventory" && <section className="stack"><article className="panel"><h3>Inventario</h3><ul className="simple-list">{(data.inventory || []).map((i) => <li key={i.id}><div><span>{i.productName}</span><small>Cantidad actual: {num(i.quantity).toFixed(2)} unid</small></div><div className="rowEdit"><input className="inlineQty" type="number" min="0" step="0.01" value={inventoryDraft[i.id] ?? i.quantity} onChange={(e) => setInventoryDraft((d) => ({ ...d, [i.id]: e.target.value }))} /><button className="secondary btnMini" type="button" onClick={() => saveInventoryRow(i)}>Editar</button></div></li>)}</ul></article><article className="panel form-panel"><h3>Cargar inventario</h3><form className="form" onSubmit={saveInventory}><label>Producto<select value={inventoryForm.productId} onChange={(e) => setInventoryForm((d) => ({ ...d, productId: e.target.value }))}><option value="">Selecciona producto</option>{(data.products || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Cantidad<input type="number" min="0" step="0.01" value={inventoryForm.quantity} onChange={(e) => setInventoryForm((d) => ({ ...d, quantity: e.target.value }))} /></label><button className="primary full" type="submit">Guardar inventario</button></form></article><article className="panel form-panel"><h3>Transferir a vendedor</h3><form className="form" onSubmit={transferInventory}><label>Vendedor<select value={transferForm.sellerId} onChange={(e) => setTransferForm((d) => ({ ...d, sellerId: e.target.value }))}><option value="">Selecciona vendedor</option>{(data.sellers || []).filter((s) => s.role === "seller" && s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label>Producto<select value={transferForm.productId} onChange={(e) => setTransferForm((d) => ({ ...d, productId: e.target.value }))}><option value="">Selecciona producto</option>{(data.products || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Cantidad<input type="number" min="0" step="0.01" value={transferForm.quantity} onChange={(e) => setTransferForm((d) => ({ ...d, quantity: e.target.value }))} /></label><button className="secondary full" type="submit">Transferir</button></form></article></section>}

      {!loading && tab === "production" && (
        <section className="stack">
          <article className="panel">
            <h3>Produccion</h3>
            <label>Producto propio<select value={productionProductId} onChange={(e) => { const id = e.target.value; setProductionProductId(id); setRecipeForm((d) => ({ ...d, productId: id })); setBatchForm((d) => ({ ...d, productId: id })); setProductionOpen({ raw: false, recipe: false, cost: false, batch: false }); }}><option value="">Selecciona producto</option>{ownProductionProducts.map((p) => <option key={`own_${p.id}`} value={p.id}>{p.name}</option>)}</select></label>
            {!selectedProductionProduct ? <p className="preview">Marca productos como produccion propia en la pestaña Productos para que aparezcan aqui.</p> : <>
              <div className="cards-grid"><article className="stat-card warm"><span>Sugerencia de produccion</span><strong>{num(selectedProductionSummary?.suggestedProduction || 0).toFixed(2)} unid</strong><small>Demanda semana: {num(selectedProductionSummary?.weekDemandQty || 0).toFixed(2)} | Stock: {num(selectedProductionSummary?.currentStock || 0).toFixed(2)}</small></article></div>

              <div className="miniActions"><button className="secondary btnMini" type="button" onClick={() => setProductionOpen((s) => ({ ...s, raw: !s.raw }))}>{productionOpen.raw ? "Ocultar" : "Materia prima"}</button><button className="secondary btnMini" type="button" onClick={() => setProductionOpen((s) => ({ ...s, recipe: !s.recipe }))}>{productionOpen.recipe ? "Ocultar" : "Receta"}</button><button className="secondary btnMini" type="button" onClick={() => setProductionOpen((s) => ({ ...s, cost: !s.cost }))}>{productionOpen.cost ? "Ocultar" : "Costos de produccion"}</button><button className="secondary btnMini" type="button" onClick={() => setProductionOpen((s) => ({ ...s, batch: !s.batch }))}>{productionOpen.batch ? "Ocultar" : "Lote producido"}</button></div>

              {productionOpen.raw ? <article className="panel form-panel"><h3>Materia prima</h3><form className="form" onSubmit={saveRawMaterial}><label>Nombre<input required value={rawMaterialForm.name} onChange={(e) => setRawMaterialForm((d) => ({ ...d, name: e.target.value }))} /></label><label>Unidad<input value={rawMaterialForm.unit} onChange={(e) => setRawMaterialForm((d) => ({ ...d, unit: e.target.value }))} /></label><label>Stock inicial<input type="number" min="0" step="0.01" value={rawMaterialForm.stockQty} onChange={(e) => setRawMaterialForm((d) => ({ ...d, stockQty: e.target.value }))} /></label><label>Costo inicial por unidad<input type="number" min="0" step="0.01" value={rawMaterialForm.costPerUnit} onChange={(e) => setRawMaterialForm((d) => ({ ...d, costPerUnit: e.target.value }))} /></label><label>Asociar producto<select value={rawMaterialProductDraft} onChange={(e) => setRawMaterialProductDraft(e.target.value)}><option value="">Opcional</option>{(data.products || []).map((p) => <option key={`raw_prod_${p.id}`} value={p.id}>{p.name}</option>)}</select></label><div className="miniActions"><button className="btnMini" type="button" onClick={addRawMaterialProductAssociation}>Asociar</button></div><ul className="simple-list">{(rawMaterialForm.appliesToProductIds || []).map((productId) => { const productName = (data.products || []).find((p) => p.id === productId)?.name || productId; return <li key={`raw_assoc_${productId}`}><span>{productName}</span><button className="danger btnMini" type="button" onClick={() => removeRawMaterialProductAssociation(productId)}>Quitar</button></li>; })}</ul><button className="primary full" type="submit">Guardar materia prima</button></form>
                <form className="form" onSubmit={saveRawMaterialRestock}><h4>Recargar stock MP</h4><label>Materia prima<select value={restockForm.materialId} onChange={(e) => setRestockForm((d) => ({ ...d, materialId: e.target.value }))}><option value="">Selecciona materia prima</option>{(data.rawMaterials || []).filter((mat) => !mat.appliesToProductIds?.length || mat.appliesToProductIds.includes(selectedProductionProduct.id)).map((mat) => <option key={`restock_${mat.id}`} value={mat.id}>{mat.name}</option>)}</select></label><label>Fecha<input type="date" value={restockForm.date} onChange={(e) => setRestockForm((d) => ({ ...d, date: e.target.value }))} /></label><label>Cantidad recargada<input type="number" min="0.0001" step="0.0001" value={restockForm.qtyAdded} onChange={(e) => setRestockForm((d) => ({ ...d, qtyAdded: e.target.value }))} /></label><label>Costo por unidad<input type="number" min="0" step="0.0001" value={restockForm.unitCost} onChange={(e) => setRestockForm((d) => ({ ...d, unitCost: e.target.value }))} /></label><button className="secondary full" type="submit">Guardar recarga</button></form>
                <ul className="simple-list">{(data.rawMaterialRestocks || []).filter((row) => { const mat = (data.rawMaterials || []).find((m) => m.id === row.materialId); return !!mat && (!mat.appliesToProductIds?.length || mat.appliesToProductIds.includes(selectedProductionProduct.id)); }).slice(0, 20).map((row) => <li key={row.id}><div><span>{row.materialName} ({date(row.date)})</span><small>+{num(row.qtyAdded).toFixed(2)} {row.unit} | costo: {money(row.unitCost)}</small><small>Stock: {num(row.previousStockQty).toFixed(2)} {"->"} {num(row.newStockQty).toFixed(2)}</small></div><strong>{money(row.totalCost)}</strong></li>)}</ul></article> : null}

              {productionOpen.recipe ? <article className="panel form-panel"><h3>Receta</h3><form className="form" onSubmit={saveRecipe}><label>Rendimiento receta (unid finales)<input type="number" min="0.01" step="0.01" value={recipeForm.yieldQty} onChange={(e) => setRecipeForm((d) => ({ ...d, yieldQty: e.target.value }))} /></label><label>Materia prima<select value={recipeComponentDraft.materialId} onChange={(e) => setRecipeComponentDraft((d) => ({ ...d, materialId: e.target.value }))}><option value="">Selecciona materia prima</option>{(data.rawMaterials || []).filter((mat) => !mat.appliesToProductIds?.length || mat.appliesToProductIds.includes(selectedProductionProduct.id)).map((mat) => <option key={mat.id} value={mat.id}>{mat.name}</option>)}</select></label><label>Cantidad requerida por receta<input type="number" min="0.0001" step="0.0001" value={recipeComponentDraft.qty} onChange={(e) => setRecipeComponentDraft((d) => ({ ...d, qty: e.target.value }))} /></label><div className="miniActions"><button className="btnMini" type="button" onClick={addRecipeComponent}>Agregar materia prima</button></div><ul className="simple-list">{recipeComponents.map((row) => <li key={`rc_${row.materialId}`}><span>{row.materialName}</span><div className="miniActions"><small>{num(row.qty).toFixed(4)}</small><button className="danger btnMini" type="button" onClick={() => removeRecipeComponent(row.materialId)}>Quitar</button></div></li>)}</ul><button className="primary full" type="submit">Guardar receta</button></form>{selectedProductRecipe ? <p className="preview">Receta actual: rendimiento {num(selectedProductRecipe.yieldQty).toFixed(2)} unid.</p> : <p className="preview">Aun no hay receta para este producto.</p>}</article> : null}

              {productionOpen.cost ? <article className="panel"><h3>Costos de produccion</h3><ul className="simple-list">{(data.productionSummary?.averageUnitCostByProduct || []).filter((row) => String(row.productId || "") === selectedProductionProduct.id).map((row) => <li key={`cost_avg_${row.productId || row.productName}`}><span>{row.productName}</span><strong>{money(row.avgUnitCost)}/unid</strong></li>)}</ul><ul className="simple-list">{(data.productionSummary?.requiredMaterials || []).filter((row) => { const mat = (data.rawMaterials || []).find((m) => m.id === row.materialId); return !!mat && (!mat.appliesToProductIds?.length || mat.appliesToProductIds.includes(selectedProductionProduct.id)); }).map((row) => <li key={`mat_req_${row.materialId}`}><div><span>{row.materialName}</span><small>Necesario: {num(row.requiredQty).toFixed(2)} {row.unit}</small><small>Stock: {num(row.currentStock).toFixed(2)} {row.unit}</small></div><strong>Comprar: {num(row.toBuyQty).toFixed(2)} {row.unit}</strong></li>)}</ul></article> : null}

              {productionOpen.batch ? <article className="panel form-panel"><h3>Lote producido</h3><form className="form" onSubmit={saveBatch}><label>Fecha<input type="date" value={batchForm.date} onChange={(e) => setBatchForm((d) => ({ ...d, date: e.target.value }))} /></label><label>Cantidad producida (unid)<input type="number" min="0.01" step="0.01" value={batchForm.outputQty} onChange={(e) => setBatchForm((d) => ({ ...d, outputQty: e.target.value }))} /></label><label>Notas<textarea rows="2" value={batchForm.notes} onChange={(e) => setBatchForm((d) => ({ ...d, notes: e.target.value }))} /></label><button className="primary full" type="submit">Guardar lote</button></form><ul className="simple-list">{(data.productionBatches || []).filter((batch) => String(batch.productId || "") === selectedProductionProduct.id).slice(0, 20).map((batch) => <li key={batch.id}><div><span>{batch.productName}</span><small>{date(batch.date)} | Produccion: {num(batch.outputQty).toFixed(2)} unid</small></div><strong>{money(batch.unitCost)}/unid</strong></li>)}</ul></article> : null}
            </>}
          </article>
        </section>
      )}

      {!loading && tab === "sellers" && <section className="panel"><h3>Vendedores</h3><ul className="simple-list">{(data.sellerOverview || []).map((s) => <li key={s.sellerId}><div><span>{s.sellerName}</span><small>Clientes: {s.totalClients} | Deuda: {money(s.totalDebt)}</small><small>Semana: {money(s.weekSales)} | Mes: {money(s.monthSales)}</small></div><strong>Comision: {money(s.commissionAmount)}</strong></li>)}</ul></section>}

      {!loading && tab === "reports" && <section className="stack"><article className="panel"><h3>Reportes y Respaldo</h3><a href={reportUrl} target="_blank" rel="noreferrer" className="primary full fakeBtn">Descargar reporte XLSX</a><div className="miniActions"><button className="secondary btnMini" type="button" onClick={createServerBackup} disabled={backupBusy}>{backupBusy ? "Creando..." : "Crear backup servidor"}</button><a href={dbExportUrl} target="_blank" rel="noreferrer" className="btnMini fakeBtn">Exportar JSON</a></div><p className="preview">Incluye admin y vendedores (misma base de datos).</p>{lastBackupFile ? <p className="preview">Ultimo backup: {lastBackupFile}</p> : null}</article><article className="panel"><h3>Degustaciones y Conversion</h3><p className="preview">Degustaciones: {degustationSummary.totalDegustations}</p><p className="preview">Prospectos degustados: {degustationSummary.uniqueProspects}</p><p className="preview">Prospectos convertidos: {degustationSummary.converted}</p><p className="preview">Tasa de conversion: {degustationSummary.conversionRate.toFixed(1)}%</p><ul className="simple-list">{degustationSummary.latest.map((item) => <li key={item.id}><div><span>{item.prospectName}</span><small>{date(item.date)}</small></div><div className="rightCol"><small>{item.status}</small>{item.convertedClientName ? <small>{item.convertedClientName}</small> : null}</div></li>)}</ul>{degustationSummary.latest.length === 0 ? <p className="preview">Sin degustaciones registradas.</p> : null}</article></section>}

      {tab === "newVisit" && <section className="panel form-panel"><h3>Nueva visita</h3><form className="form" onSubmit={saveVisit}><label>Tipo de visita<select value={visitForm.visitType} onChange={(e) => setVisitForm((d) => ({ ...d, visitType: e.target.value, saleType: e.target.value === "degustacion" ? "degustacion" : d.saleType }))}><option value="dispatch">Con despacho</option><option value="count_only">Solo conteo</option><option value="degustacion">Degustacion</option></select></label><label>Fecha<input type="date" value={visitForm.date} onChange={(e) => setVisitForm((d) => ({ ...d, date: e.target.value }))} /></label><label>Cliente (opcional en degustacion)<select value={visitForm.clientId} onChange={(e) => setVisitForm((d) => ({ ...d, clientId: e.target.value }))}><option value="">Selecciona cliente</option>{(data.clients || []).map((c) => <option key={c.id} value={c.id}>{c.tradeName || c.name}</option>)}</select></label>{visitForm.visitType === "degustacion" ? <><label>Prospecto comercio (si no es cliente)<input value={visitForm.prospectTradeName} onChange={(e) => setVisitForm((d) => ({ ...d, prospectTradeName: e.target.value }))} /></label><label>Prospecto responsable<input value={visitForm.prospectBuyerName} onChange={(e) => setVisitForm((d) => ({ ...d, prospectBuyerName: e.target.value }))} /></label><label>Prospecto telefono<input value={visitForm.prospectPhone} onChange={(e) => setVisitForm((d) => ({ ...d, prospectPhone: e.target.value }))} /></label></> : null}<label>Producto<select value={visitForm.productId} onChange={(e) => { const p = data.products.find((x) => x.id === e.target.value); setVisitForm((d) => ({ ...d, productId: e.target.value, unitPrice: d.unitPrice || String(num(p?.unitPrice)) })); }}><option value="">Selecciona producto</option>{(data.products || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Cantidad<input type="number" min="0" step="0.01" value={visitForm.quantity} onChange={(e) => setVisitForm((d) => ({ ...d, quantity: e.target.value }))} /></label>{visitForm.visitType !== "degustacion" ? <label>Valor unitario<input type="number" min="0" step="0.01" value={visitForm.unitPrice} onChange={(e) => setVisitForm((d) => ({ ...d, unitPrice: e.target.value }))} /></label> : null}{visitForm.visitType !== "degustacion" ? <label>Restante en cliente<input type="number" min="0" step="0.01" value={visitForm.remaining} onChange={(e) => setVisitForm((d) => ({ ...d, remaining: e.target.value }))} /></label> : null}{visitForm.visitType !== "degustacion" ? <label>Monto cobrado<input type="number" min="0" step="0.01" value={visitForm.amountCollected} onChange={(e) => setVisitForm((d) => ({ ...d, amountCollected: e.target.value }))} /></label> : null}{visitForm.visitType !== "degustacion" ? <label>Tipo venta<select value={visitForm.saleType} onChange={(e) => setVisitForm((d) => ({ ...d, saleType: e.target.value }))}><option value="consignado">Consignado</option><option value="a_vista">A vista</option><option value="boleto">Boleto</option></select></label> : <label>Tipo venta<input value="degustacion" readOnly /></label>}<label>Proxima visita<input type="date" value={visitForm.nextVisitDate} onChange={(e) => setVisitForm((d) => ({ ...d, nextVisitDate: e.target.value }))} /></label><label>Notas<textarea rows="3" value={visitForm.notes} onChange={(e) => setVisitForm((d) => ({ ...d, notes: e.target.value }))} /></label><button className="primary full" type="submit">Guardar visita</button></form></section>}
      {showClientModal && (
        <div className="modalBackdrop" role="dialog" aria-modal="true">
          <div className="modalCard">
            <h3>Nuevo cliente</h3>
            <p className="preview">ID interno: automatico</p>
            <form className="form" onSubmit={saveClient}>
              <div className="miniActions">
                <button className={clientForm.managedByType === "owner" ? "secondary btnMini" : "btnMini"} type="button" onClick={() => updateClientForm({ managedByType: "owner", managedBySellerId: "" })}>Yo</button>
                <button className={clientForm.managedByType === "seller" ? "secondary btnMini" : "btnMini"} type="button" onClick={() => updateClientForm({ managedByType: "seller" })}>Vendedor</button>
              </div>
              {clientForm.managedByType === "seller" ? (
                <label>
                  Vendedor
                  <select value={clientForm.managedBySellerId} onChange={(e) => updateClientForm({ managedBySellerId: e.target.value })}>
                    <option value="">Selecciona vendedor</option>
                    {sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
              ) : null}
              <label>Nombre comercio<input required value={clientForm.tradeName} onChange={(e) => updateClientForm({ tradeName: e.target.value })} /></label>
              <label>Responsable compras<input value={clientForm.buyerName} onChange={(e) => updateClientForm({ buyerName: e.target.value })} /></label>
              <label>CPF<input value={clientForm.cpf} onChange={(e) => updateClientForm({ cpf: e.target.value })} /></label>
              <label>CNPJ<input value={clientForm.cnpj} onChange={(e) => updateClientForm({ cnpj: e.target.value })} /></label>
              <button className="btnMini" type="button" onClick={lookupCnpj}>{loadingCnpj ? "Buscando..." : "Buscar CNPJ"}</button>
              <label>CEP<input value={clientForm.cep} onChange={(e) => updateClientForm({ cep: e.target.value })} /></label>
              <button className="btnMini" type="button" onClick={lookupCep}>{loadingCep ? "Buscando..." : "Buscar CEP"}</button>
              <label>Calle<input value={clientForm.addressStreet} onChange={(e) => updateClientForm({ addressStreet: e.target.value })} /></label>
              <label>Numero predio<input value={clientForm.addressNumber} onChange={(e) => updateClientForm({ addressNumber: e.target.value })} /></label>
              <label>Barrio<input value={clientForm.addressNeighborhood} onChange={(e) => updateClientForm({ addressNeighborhood: e.target.value })} /></label>
              <label>Ciudad<input value={clientForm.addressCity} onChange={(e) => updateClientForm({ addressCity: e.target.value })} /></label>
              <label>Estado<input value={clientForm.addressState} onChange={(e) => updateClientForm({ addressState: e.target.value })} /></label>
              <label>Tipo comercio<input value={clientForm.type} onChange={(e) => updateClientForm({ type: e.target.value })} /></label>
              <label>Telefono<input value={clientForm.phone} onChange={(e) => updateClientForm({ phone: e.target.value })} /></label>
              <label>Correo<input value={clientForm.email} onChange={(e) => updateClientForm({ email: e.target.value })} /></label>
              <label>IE<input value={clientForm.ie} onChange={(e) => updateClientForm({ ie: e.target.value })} /></label>
              <label>Observaciones<textarea rows="3" value={clientForm.observations} onChange={(e) => updateClientForm({ observations: e.target.value })} /></label>
              <div className="modalActions">
                <button className="btnMini" type="button" onClick={closeClientModal}>Cancelar</button>
                <button className="primary btnMini" disabled={savingClient} type="submit">{savingClient ? "Guardando..." : "Guardar cliente"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

    </main>
  );
}
