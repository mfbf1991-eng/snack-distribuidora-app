import React, { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, TextInput, Pressable, StyleSheet, ActivityIndicator, Alert, Modal, Linking, RefreshControl, Image, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as Clipboard from "expo-clipboard";
import DateTimePicker from "@react-native-community/datetimepicker";

const API_BASE = (process.env.EXPO_PUBLIC_API_URL || "http://localhost:4000/api").replace(/\/$/, "");
const today = () => new Date().toISOString().slice(0, 10);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const digits = (v) => String(v || "").replace(/\D/g, "");
const fmt = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("pt-BR") : "-");
const money = (v) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(num(v));
const isThisWeekDate = (dateString) => {
  if (!dateString) return false;
  const date = new Date(`${dateString}T00:00:00`);
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const day = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - day);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return date >= start && date < end;
};
const availabilitySourceLabel = (source) => (String(source || "").toLowerCase() === "conteo" ? "conteo" : "estimado");
const CLIENT_FORM_INITIAL = { tradeName: "", buyerName: "", cep: "", addressStreet: "", addressNumber: "", addressNeighborhood: "", addressCity: "", addressState: "", location: "", type: "", phone: "", email: "", cpf: "", cnpj: "", ie: "", observations: "", managedByType: "owner", managedBySellerId: "" };
const LOGO = require("./assets/logo-platanito.jpg");
TextInput.defaultProps = TextInput.defaultProps || {};
TextInput.defaultProps.placeholderTextColor = "#8f816f";
function computeAvailabilityFromVisits(visits, clientId) {
  const timeline = (Array.isArray(visits) ? visits : [])
    .filter((visit) => String(visit.clientId || "") === String(clientId || ""))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  const byProduct = new Map();
  for (const visit of timeline) {
    const visitType = String(visit.visitType || "dispatch").trim().toLowerCase();
    const items = Array.isArray(visit.items) ? visit.items : [];
    for (const item of items) {
      const productName = String(item.productName || "").trim();
      if (!productName) continue;
      const productId = String(item.productId || "").trim();
      const key = productId || productName.toLowerCase();
      const current = byProduct.get(key) || { productId, productName, availableQty: 0, lastUpdated: "", source: "estimado" };
      const hasRemaining = item.remaining !== null && item.remaining !== undefined && String(item.remaining).trim() !== "";
      if (visitType === "count_only" || hasRemaining) {
        if (hasRemaining) {
          current.availableQty = Math.max(0, num(item.remaining));
          current.source = "conteo";
          current.lastUpdated = String(visit.date || "");
        }
      } else {
        current.availableQty = Math.max(0, num(item.quantity));
        if (current.source !== "conteo") current.source = "estimado";
        current.lastUpdated = String(visit.date || "");
      }
      byProduct.set(key, current);
    }
  }
  return [...byProduct.values()].sort((a, b) => String(a.productName).localeCompare(String(b.productName), "es", { sensitivity: "base" }));
}

async function apiGet(path) {
  const r = await fetch(`${API_BASE}${path}`);
  const raw = await r.text();
  let j;
  try { j = JSON.parse(raw); } catch { j = { error: raw?.slice?.(0, 120) || "Respuesta invalida del servidor" }; }
  if (!r.ok) throw new Error(j.error || "Error de conexion");
  return j;
}
async function apiPost(path, body) {
  const r = await fetch(`${API_BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const raw = await r.text();
  let j;
  try { j = JSON.parse(raw); } catch { j = { error: raw?.slice?.(0, 120) || "Respuesta invalida del servidor" }; }
  if (!r.ok) throw new Error(j.error || "Error al guardar");
  return j;
}
async function apiPut(path, body) {
  const r = await fetch(`${API_BASE}${path}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const raw = await r.text();
  let j;
  try { j = JSON.parse(raw); } catch { j = { error: raw?.slice?.(0, 120) || "Respuesta invalida del servidor" }; }
  if (!r.ok) throw new Error(j.error || "Error al guardar");
  return j;
}
async function apiDelete(path) {
  const r = await fetch(`${API_BASE}${path}`, { method: "DELETE" });
  const raw = await r.text();
  let j;
  try { j = JSON.parse(raw); } catch { j = { error: raw?.slice?.(0, 120) || "Respuesta invalida del servidor" }; }
  if (!r.ok) throw new Error(j.error || "Error al eliminar");
  return j;
}

export default function App() {
  const [tab, setTab] = useState("panel");
  const [selectedClientId, setSelectedClientId] = useState("");
  const [selectedVisitId, setSelectedVisitId] = useState("");
  const [selectedSellerId, setSelectedSellerId] = useState("");
  const [selectedClientSaleVisitId, setSelectedClientSaleVisitId] = useState("");
  const [showClientSalesList, setShowClientSalesList] = useState(false);
  const [showClientAccount, setShowClientAccount] = useState(false);
  const [showClientForm, setShowClientForm] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [showVisitsActions, setShowVisitsActions] = useState(false);
  const [showVisitScheduleForm, setShowVisitScheduleForm] = useState(false);
  const [visitEntryType, setVisitEntryType] = useState("dispatch");
  const [showProductForm, setShowProductForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingCep, setLoadingCep] = useState(false);
  const [loadingCnpj, setLoadingCnpj] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [backupBusy, setBackupBusy] = useState(false);
  const [lastBackupFile, setLastBackupFile] = useState("");
  const [showPanelWeekDetails, setShowPanelWeekDetails] = useState(false);
  const [showPanelDebtDetails, setShowPanelDebtDetails] = useState(false);
  const [savingMovement, setSavingMovement] = useState(false);

  const [data, setData] = useState({ clients: [], prospects: [], visits: [], sellers: [], sellerOverview: [], appointments: [], products: [], inventory: [], rawMaterials: [], rawMaterialRestocks: [], productionRecipes: [], productionBatches: [], productionSummary: { byProduct: [], requiredMaterials: [], averageUnitCostByProduct: [], totalEstimatedBuyCost: 0 }, productGoals: [], clientMovements: [], ownerProductGoalProgress: [], settings: { ownerWeeklyGoal: 0 }, dashboard: { totalSoldThisWeek: 0, totalDebt: 0, clientsNeedingVisit: [], topClients: [], ownerWeeklyGoal: 0, ownerWeeklyRemaining: 0, ownerWeeklyProgressPct: 0 } });

  const [clientForm, setClientForm] = useState(CLIENT_FORM_INITIAL);
  const [visitForm, setVisitForm] = useState({ date: today(), clientId: "", prospectTradeName: "", prospectBuyerName: "", prospectPhone: "", amountCollected: "", collectionMethod: "efectivo", saleType: "consignado", boletoDays: 7, nextVisitDate: "", notes: "" });
  const [visitItems, setVisitItems] = useState([]);
  const [visitItemDraft, setVisitItemDraft] = useState({ productId: "", productQuery: "", quantity: "", unitPrice: "" });
  const [showProductSuggestions, setShowProductSuggestions] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({ date: today(), notes: "" });
  const [visitScheduleForm, setVisitScheduleForm] = useState({ clientId: "", date: today(), notes: "" });
  const [visitScheduleClientQuery, setVisitScheduleClientQuery] = useState("");
  const [showVisitScheduleClientSuggestions, setShowVisitScheduleClientSuggestions] = useState(false);
  const [visitFilters, setVisitFilters] = useState({ tradeName: "", buyerName: "", internalId: "", date: "" });
  const [productForm, setProductForm] = useState({ name: "", unitPrice: "", ownProduction: false });
  const [inventoryForm, setInventoryForm] = useState({ productId: "", productName: "", quantity: "" });
  const [inventorySelectedProductId, setInventorySelectedProductId] = useState("");
  const [inventoryEditQty, setInventoryEditQty] = useState({});
  const [transferForm, setTransferForm] = useState({ sellerId: "", productId: "", quantity: "" });
  const [ownerProductGoalForm, setOwnerProductGoalForm] = useState({ productId: "", productName: "", targetQty: "" });
  const [visitClientQuery, setVisitClientQuery] = useState("");
  const [showClientSuggestions, setShowClientSuggestions] = useState(false);
  const [reportFilters, setReportFilters] = useState({ from: "", to: "", clientId: "", saleType: "all" });
  const [reportClientQuery, setReportClientQuery] = useState("");
  const [showReportClientSuggestions, setShowReportClientSuggestions] = useState(false);
  const [salesFilters, setSalesFilters] = useState({ date: today(), clientId: "", sellerId: "", saleType: "all" });
  const [salesClientQuery, setSalesClientQuery] = useState("");
  const [showSalesClientSuggestions, setShowSalesClientSuggestions] = useState(false);
  const [showNextVisitPicker, setShowNextVisitPicker] = useState(false);
  const [showVisitDatePicker, setShowVisitDatePicker] = useState(false);
  const [showScheduleDatePicker, setShowScheduleDatePicker] = useState(false);
  const [showVisitScheduleDatePicker, setShowVisitScheduleDatePicker] = useState(false);
  const [showVisitFilterDatePicker, setShowVisitFilterDatePicker] = useState(false);
  const [showSalesDatePicker, setShowSalesDatePicker] = useState(false);
  const [showMovementDatePicker, setShowMovementDatePicker] = useState(false);
  const [invoiceForm, setInvoiceForm] = useState({ invoiceNumber: "" });
  const [sellerGoalsForm, setSellerGoalsForm] = useState({ weeklyGoal: "", monthlyGoal: "", commissionRate: "" });
  const [sellerStockForm, setSellerStockForm] = useState({ productId: "", productName: "", quantity: "", notes: "" });
  const [sellerClientFilter, setSellerClientFilter] = useState("");
  const [ownerGoalForm, setOwnerGoalForm] = useState({ ownerWeeklyGoal: "" });
  const [rawMaterialForm, setRawMaterialForm] = useState({ name: "", unit: "kg", stockQty: "", costPerUnit: "", appliesToProductIds: [] });
  const [rawMaterialProductDraft, setRawMaterialProductDraft] = useState("");
  const [restockForm, setRestockForm] = useState({ materialId: "", qtyAdded: "", unitCost: "", date: today(), supplier: "", notes: "" });
  const [productionProductId, setProductionProductId] = useState("");
  const [productionOpen, setProductionOpen] = useState({ raw: false, recipe: false, cost: false, batch: false });
  const [recipeForm, setRecipeForm] = useState({ productId: "", yieldQty: "" });
  const [recipeComponentDraft, setRecipeComponentDraft] = useState({ materialId: "", qty: "" });
  const [recipeComponents, setRecipeComponents] = useState([]);
  const [batchForm, setBatchForm] = useState({ date: today(), productId: "", outputQty: "", notes: "" });
  const [clientMovementForm, setClientMovementForm] = useState({
    date: today(),
    type: "ajuste",
    productId: "",
    productName: "",
    quantity: "",
    notes: ""
  });

  async function loadAll() {
    try {
      setLoading(true);
      setError("");
      const p = await apiGet("/data");
      setData({ clients: p.clients || [], prospects: p.prospects || [], visits: p.visits || [], sellers: p.sellers || [], sellerOverview: p.sellerOverview || [], appointments: p.appointments || [], products: p.products || [], inventory: p.inventory || [], rawMaterials: p.rawMaterials || [], rawMaterialRestocks: p.rawMaterialRestocks || [], productionRecipes: p.productionRecipes || [], productionBatches: p.productionBatches || [], productionSummary: p.productionSummary || { byProduct: [], requiredMaterials: [], averageUnitCostByProduct: [], totalEstimatedBuyCost: 0 }, productGoals: p.productGoals || [], clientMovements: p.clientMovements || [], ownerProductGoalProgress: p.ownerProductGoalProgress || [], settings: p.settings || { ownerWeeklyGoal: 0 }, dashboard: p.dashboard || { totalSoldThisWeek: 0, totalDebt: 0, clientsNeedingVisit: [], topClients: [], ownerWeeklyGoal: 0, ownerWeeklyRemaining: 0, ownerWeeklyProgressPct: 0 } });
      setOwnerGoalForm({ ownerWeeklyGoal: String(num((p.settings || {}).ownerWeeklyGoal)) });
    } catch (e) { setError(e.message || "Error"); } finally { setLoading(false); }
  }

  useEffect(() => { loadAll(); }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 1500); return () => clearTimeout(t); }, [toast]);

  async function onRefresh() {
    try {
      setRefreshing(true);
      await loadAll();
    } finally {
      setRefreshing(false);
    }
  }

  const selectedClient = useMemo(() => data.clients.find((c) => c.id === selectedClientId) || null, [data.clients, selectedClientId]);
  const selectedClientSaleVisit = useMemo(
    () => data.visits.find((v) => v.id === selectedClientSaleVisitId) || null,
    [data.visits, selectedClientSaleVisitId]
  );
  const selectedVisit = useMemo(() => data.visits.find((v) => v.id === selectedVisitId) || null, [data.visits, selectedVisitId]);
  const selectedVisitClient = useMemo(
    () => (selectedVisit ? data.clients.find((c) => c.id === selectedVisit.clientId) || null : null),
    [selectedVisit, data.clients]
  );
  const selectedSellerOverview = useMemo(
    () => data.sellerOverview.find((item) => item.sellerId === selectedSellerId) || null,
    [data.sellerOverview, selectedSellerId]
  );
  const selectedSellerClientIds = useMemo(
    () => new Set((selectedSellerOverview?.assignedClients || []).map((client) => client.id)),
    [selectedSellerOverview]
  );
  const sellerAssignableClients = useMemo(() => {
    const q = sellerClientFilter.trim().toLowerCase();
    return data.clients
      .filter((client) => !selectedSellerClientIds.has(client.id))
      .filter((client) => {
        if (!q) return true;
        const name = String(client.tradeName || client.name || "").toLowerCase();
        const buyer = String(client.buyerName || client.contact || "").toLowerCase();
        const internalId = String(client.internalId || "").toLowerCase();
        return name.includes(q) || buyer.includes(q) || internalId.includes(q) || String(client.id || "").toLowerCase().includes(q);
      })
      .sort((a, b) => String(a.tradeName || a.name || "").localeCompare(String(b.tradeName || b.name || ""), "es", { sensitivity: "base" }));
  }, [data.clients, selectedSellerClientIds, sellerClientFilter]);
  const sellers = useMemo(() => (data.sellers || []).filter((s) => s.role === "seller" && s.active), [data.sellers]);
  const selectedProductionRecipe = useMemo(() => {
    const productId = String(recipeForm.productId || "");
    if (!productId) return null;
    return (data.productionRecipes || []).find((recipe) => String(recipe.productId || "") === productId) || null;
  }, [data.productionRecipes, recipeForm.productId]);
  const ownProductionProducts = useMemo(
    () => (data.products || []).filter((row) => row.active !== false && row.ownProduction === true),
    [data.products]
  );
  const selectedProductionProduct = useMemo(
    () => ownProductionProducts.find((row) => row.id === productionProductId) || null,
    [ownProductionProducts, productionProductId]
  );
  const selectedProductionSummary = useMemo(
    () => (data.productionSummary?.byProduct || []).find((row) => String(row.productId || "") === String(productionProductId || "")) || null,
    [data.productionSummary, productionProductId]
  );
  const clientVisits = useMemo(() => !selectedClient ? [] : data.visits.filter((v) => v.clientId === selectedClient.id).sort((a, b) => new Date(b.date) - new Date(a.date)), [data.visits, selectedClient]);
  const clientAppts = useMemo(() => !selectedClient ? [] : data.appointments.filter((a) => a.clientId === selectedClient.id && a.status !== "done").sort((a, b) => new Date(a.date) - new Date(b.date)), [data.appointments, selectedClient]);
  const accountSummary = useMemo(() => {
    if (!selectedClient) return null;
    const visits = data.visits.filter((v) => v.clientId === selectedClient.id).sort((a, b) => new Date(b.date) - new Date(a.date));
    const payments = visits.filter((v) => num(v.amountCollected) > 0).map((v) => ({ id: v.id, date: v.date, amount: num(v.amountCollected) }));
    const acquisitions = visits.map((v) => ({
      id: v.id,
      date: v.date,
      amount: num(v.totalValue ?? v.soldAmount),
      saleType: v.saleType || v.paymentType,
      dueDate: v.dueDate || "",
      boletoDays: Number(v.boletoDays || 0),
      boletoPaid: !!v.boletoPaid
    }));
    const totalCollected = payments.reduce((acc, p) => acc + p.amount, 0);
    const debt = num(selectedClient.debt);
    const now = new Date();
    const boletos = acquisitions
      .filter((v) => String(v.saleType || "").toLowerCase() === "boleto" || v.boletoDays > 0 || String(v.dueDate || "").trim() !== "")
      .map((v) => {
        const expired = v.dueDate ? new Date(`${v.dueDate}T23:59:59`) < now : false;
        const status = v.boletoPaid ? "Pagado" : expired ? "Vencido" : "Pendiente";
        return { ...v, expired, status };
      });
    const overdueAmount = boletos.filter((b) => b.status === "Vencido").reduce((acc, b) => acc + b.amount, 0);
    const upcomingAmount = boletos.filter((b) => b.status === "Pendiente").reduce((acc, b) => acc + b.amount, 0);
    const lastPaymentDate = payments[0]?.date || "";
    const daysWithoutPayment = lastPaymentDate ? Math.floor((Date.now() - new Date(`${lastPaymentDate}T00:00:00`).getTime()) / (1000 * 60 * 60 * 24)) : null;
    let risk = "Al dia";
    if (debt > 0 && overdueAmount > 0) risk = "Critico";
    else if (debt > 0) risk = "Atencion";
    return { payments, acquisitions, totalCollected, debt, boletos, overdueAmount, upcomingAmount, daysWithoutPayment, risk };
  }, [selectedClient, data.visits]);
  const selectedClientAvailability = useMemo(() => {
    if (!selectedClient) return [];
    const backendAvailability = Array.isArray(selectedClient.productAvailability) ? selectedClient.productAvailability : [];
    return backendAvailability.length > 0 ? backendAvailability : computeAvailabilityFromVisits(data.visits, selectedClient.id);
  }, [selectedClient, data.visits]);
  const selectedClientMovements = useMemo(() => {
    if (!selectedClient) return [];
    return (data.clientMovements || [])
      .filter((movement) => String(movement.clientId) === String(selectedClient.id))
      .sort((a, b) => new Date(`${b.date}T00:00:00`) - new Date(`${a.date}T00:00:00`));
  }, [selectedClient, data.clientMovements]);

  const sales = useMemo(() => {
    if (!selectedClient) return null;
    const asc = [...clientVisits].reverse();
    const sold = asc.reduce((a, v) => a + num(v.soldAmount), 0);
    const rec = asc.reduce((a, v) => a + num(v.amountCollected), 0);
    const first = asc[0]?.date ? new Date(`${asc[0].date}T00:00:00`) : new Date();
    const w = Math.max(1, Math.ceil((Date.now() - first.getTime()) / (1000 * 60 * 60 * 24 * 7)));
    const sold7 = asc.filter((v) => (Date.now() - new Date(`${v.date}T00:00:00`).getTime()) / (1000 * 60 * 60 * 24) <= 7).reduce((a, v) => a + num(v.soldAmount), 0);
    const last = clientVisits[0];
    const next = clientAppts[0]?.date || (last ? new Date(new Date(`${last.date}T00:00:00`).getTime() + 7 * 86400000).toISOString().slice(0, 10) : "");
    return { sold, rec, avg: sold / w, sold7, last, next, dispatch: num(selectedClient.suggestedDelivery) };
  }, [selectedClient, clientVisits, clientAppts]);

  const soldPreview = useMemo(() => {
    if (!visitForm.clientId) return 0;
    const asc = data.visits.filter((v) => v.clientId === visitForm.clientId).sort((a, b) => new Date(a.date) - new Date(b.date));
    const prev = asc[asc.length - 1];
    const totalItems = visitItems.reduce((acc, item) => acc + num(item.quantity), 0);
    return Math.max(0, (prev ? num(prev.delivered) : totalItems) - 0);
  }, [visitForm, data.visits, visitItems]);

  const visitProductOptions = useMemo(() => {
    return [...(data.products || [])]
      .filter((p) => p.active !== false)
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "es", { sensitivity: "base" }));
  }, [data.products]);

  const filteredVisitProductOptions = useMemo(() => {
    const q = visitItemDraft.productQuery.trim().toLowerCase();
    if (!q) return visitProductOptions;
    return visitProductOptions.filter((p) => String(p.name || "").toLowerCase().includes(q));
  }, [visitProductOptions, visitItemDraft.productQuery]);

  const visitTotals = useMemo(() => {
    const totalQuantity = visitItems.reduce((acc, item) => acc + num(item.quantity), 0);
    const totalValue = visitItems.reduce((acc, item) => acc + num(item.total), 0);
    return { totalQuantity, totalValue };
  }, [visitItems]);

  const currentVisitClient = useMemo(
    () => data.clients.find((c) => c.id === visitForm.clientId) || null,
    [data.clients, visitForm.clientId]
  );

  const productSuggestionDetails = useMemo(() => {
    if (!currentVisitClient) return [];
    const recentVisits = data.visits
      .filter((v) => v.clientId === currentVisitClient.id)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 12);
    const byProductHistory = new Map();
    for (const visit of recentVisits) {
      const items = Array.isArray(visit.items) ? visit.items : [];
      for (const item of items) {
        const key = String(item.productName || "").trim();
        if (!key) continue;
        const current = byProductHistory.get(key) || { delivered: 0, count: 0 };
        current.delivered += num(item.quantity);
        current.count += 1;
        byProductHistory.set(key, current);
      }
    }

    return visitItems.map((item) => {
      const key = String(item.productName || "").trim();
      const history = byProductHistory.get(key);
      const avgDelivered = history ? (history.delivered / Math.max(1, history.count)) : num(item.quantity);
      const remaining = item.remaining === null || item.remaining === undefined ? 0 : num(item.remaining);
      const suggested = Math.max(0, Math.ceil(avgDelivered - remaining));
      return { productName: key, avgDelivered, remaining, suggested };
    });
  }, [currentVisitClient, data.visits, visitItems]);

  const visitClientOptions = useMemo(() => {
    return [...data.clients]
      .sort((a, b) => String(a.tradeName || a.name || "").localeCompare(String(b.tradeName || b.name || ""), "es", { sensitivity: "base" }))
      .map((client) => ({
        id: client.id,
        internalId: client.internalId || "",
        name: client.tradeName || client.name || "Cliente",
        buyer: client.buyerName || client.contact || ""
      }));
  }, [data.clients]);

  const filteredVisitClientOptions = useMemo(() => {
    const q = visitClientQuery.trim().toLowerCase();
    if (!q) return visitClientOptions;
    return visitClientOptions.filter((client) =>
      client.id.toLowerCase().includes(q) ||
      client.internalId.toLowerCase().includes(q) ||
      client.name.toLowerCase().includes(q) ||
      client.buyer.toLowerCase().includes(q)
    );
  }, [visitClientOptions, visitClientQuery]);

  const filteredVisitScheduleClientOptions = useMemo(() => {
    const q = visitScheduleClientQuery.trim().toLowerCase();
    if (!q) return visitClientOptions;
    return visitClientOptions.filter((client) =>
      client.id.toLowerCase().includes(q) ||
      client.internalId.toLowerCase().includes(q) ||
      client.name.toLowerCase().includes(q) ||
      client.buyer.toLowerCase().includes(q)
    );
  }, [visitClientOptions, visitScheduleClientQuery]);

  const filteredReportClientOptions = useMemo(() => {
    const q = reportClientQuery.trim().toLowerCase();
    if (!q) return visitClientOptions;
    return visitClientOptions.filter((client) =>
      client.id.toLowerCase().includes(q) ||
      client.internalId.toLowerCase().includes(q) ||
      client.name.toLowerCase().includes(q) ||
      client.buyer.toLowerCase().includes(q)
    );
  }, [visitClientOptions, reportClientQuery]);

  const filteredSalesClientOptions = useMemo(() => {
    const q = salesClientQuery.trim().toLowerCase();
    if (!q) return visitClientOptions;
    return visitClientOptions.filter((client) =>
      client.id.toLowerCase().includes(q) ||
      client.internalId.toLowerCase().includes(q) ||
      client.name.toLowerCase().includes(q) ||
      client.buyer.toLowerCase().includes(q)
    );
  }, [visitClientOptions, salesClientQuery]);

  const reportVisits = useMemo(() => {
    return data.visits
      .filter((visit) => {
        if (reportFilters.clientId && visit.clientId !== reportFilters.clientId) return false;
        if (reportFilters.saleType !== "all" && String(visit.saleType || "") !== reportFilters.saleType) return false;
        if (reportFilters.from && String(visit.date) < reportFilters.from) return false;
        if (reportFilters.to && String(visit.date) > reportFilters.to) return false;
        return true;
      })
      .map((visit) => {
        const client = data.clients.find((c) => c.id === visit.clientId) || {};
        const totalValue = num(visit.totalValue ?? visit.soldAmount);
        const amountCollected = num(visit.amountCollected);
        const pending = Math.max(0, totalValue - amountCollected);
        const isOverdue =
          String(visit.saleType || "") === "boleto" &&
          !!visit.dueDate &&
          !visit.boletoPaid &&
          new Date(`${visit.dueDate}T23:59:59`).getTime() < Date.now();
        return {
          ...visit,
          clientName: client.tradeName || client.name || "Cliente",
          clientInternalId: client.internalId || "",
          totalValue,
          amountCollected,
          pending,
          isOverdue
        };
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [data.visits, data.clients, reportFilters]);

  const reportSummary = useMemo(() => {
    const totalSales = reportVisits.reduce((acc, visit) => acc + visit.totalValue, 0);
    const totalCollected = reportVisits.reduce((acc, visit) => acc + visit.amountCollected, 0);
    const pendingTotal = reportVisits.reduce((acc, visit) => acc + visit.pending, 0);
    const overdueTotal = reportVisits.filter((visit) => visit.isOverdue).reduce((acc, visit) => acc + visit.pending, 0);
    const upcomingTotal = reportVisits
      .filter((visit) => String(visit.saleType || "") === "boleto" && !visit.boletoPaid && !visit.isOverdue)
      .reduce((acc, visit) => acc + visit.pending, 0);

    const byClientMap = new Map();
    const byProductMap = new Map();
    const byDateMap = new Map();
    for (const visit of reportVisits) {
      const currentClient = byClientMap.get(visit.clientId) || {
        clientId: visit.clientId,
        clientName: visit.clientName,
        internalId: visit.clientInternalId,
        sales: 0,
        collected: 0,
        pending: 0
      };
      currentClient.sales += visit.totalValue;
      currentClient.collected += visit.amountCollected;
      currentClient.pending += visit.pending;
      byClientMap.set(visit.clientId, currentClient);

      const currentDate = byDateMap.get(visit.date) || { date: visit.date, sales: 0, collected: 0, pending: 0, visits: 0 };
      currentDate.sales += visit.totalValue;
      currentDate.collected += visit.amountCollected;
      currentDate.pending += visit.pending;
      currentDate.visits += 1;
      byDateMap.set(visit.date, currentDate);

      const items = Array.isArray(visit.items) ? visit.items : [];
      for (const item of items) {
        const productName = String(item.productName || "Producto").trim() || "Producto";
        const currentProduct = byProductMap.get(productName) || { productName, quantity: 0, total: 0 };
        currentProduct.quantity += num(item.quantity);
        currentProduct.total += num(item.total);
        byProductMap.set(productName, currentProduct);
      }
    }

    const byClient = [...byClientMap.values()].sort((a, b) => b.sales - a.sales);
    const byProduct = [...byProductMap.values()].sort((a, b) => b.total - a.total);
    const byDate = [...byDateMap.values()].sort((a, b) => new Date(b.date) - new Date(a.date));

    return { totalSales, totalCollected, pendingTotal, overdueTotal, upcomingTotal, byClient, byProduct, byDate };
  }, [reportVisits]);

  const salesRows = useMemo(() => {
    return data.visits
      .map((visit) => {
        const visitType = String(visit.visitType || "dispatch").toLowerCase();
        const saleType = String(visit.saleType || visit.paymentType || "").toLowerCase();
        if (visitType === "count_only" || saleType === "degustacion") return null;
        const client = data.clients.find((c) => c.id === visit.clientId) || {};
        const seller = data.sellers.find((s) => s.id === visit.createdBySellerId);
        const totalValue = num(visit.totalValue ?? visit.soldAmount);
        const amountCollected = num(visit.amountCollected);
        const pending = Math.max(0, totalValue - amountCollected);
        return {
          ...visit,
          saleType: saleType || "consignado",
          clientName: client.tradeName || client.name || visit.prospectTradeName || "Prospecto",
          sellerName: visit.createdBySellerName || (visit.createdBySellerId ? (seller?.name || "Vendedor") : "Admin"),
          totalValue,
          amountCollected,
          pending
        };
      })
      .filter(Boolean)
      .filter((row) => {
        if (salesFilters.date && String(row.date) !== String(salesFilters.date)) return false;
        if (salesFilters.clientId && String(row.clientId || "") !== String(salesFilters.clientId)) return false;
        if (salesFilters.sellerId === "admin" && row.createdBySellerId) return false;
        if (salesFilters.sellerId && salesFilters.sellerId !== "admin" && String(row.createdBySellerId || "") !== String(salesFilters.sellerId)) return false;
        if (salesFilters.saleType !== "all" && String(row.saleType || "") !== String(salesFilters.saleType)) return false;
        return true;
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [data.visits, data.clients, data.sellers, salesFilters]);

  const salesSummary = useMemo(() => ({
    totalSales: salesRows.reduce((acc, row) => acc + num(row.totalValue), 0),
    totalCollected: salesRows.reduce((acc, row) => acc + num(row.amountCollected), 0),
    totalPending: salesRows.reduce((acc, row) => acc + num(row.pending), 0)
  }), [salesRows]);

  const reportWeeklyByProduct = useMemo(() => {
    const stateMap = new Map();
    const metricMap = new Map();
    for (const visit of [...reportVisits].sort((a, b) => new Date(a.date) - new Date(b.date))) {
      const date = new Date(`${visit.date}T00:00:00`);
      const items = Array.isArray(visit.items) ? visit.items : [];
      for (const item of items) {
        const productKey = String(item.productId || item.productName || "").trim().toLowerCase();
        if (!productKey) continue;
        const productName = String(item.productName || "Producto").trim() || "Producto";
        const key = `${visit.clientId}::${productKey}`;
        const prev = stateMap.get(key);
        const hasRemaining = item.remaining !== undefined && item.remaining !== null && String(item.remaining).trim() !== "";
        const currentRemaining = hasRemaining ? num(item.remaining) : null;
        const currentDelivered = num(item.quantity);
        if (prev && currentRemaining !== null) {
          const days = Math.max(1, Math.round((date.getTime() - prev.date.getTime()) / 86400000));
          const sold = Math.max(0, prev.delivered - currentRemaining);
          const metric = metricMap.get(productKey) || { productName, sold: 0, days: 0, transitions: 0 };
          metric.sold += sold;
          metric.days += days;
          metric.transitions += 1;
          metricMap.set(productKey, metric);
        }
        stateMap.set(key, { date, delivered: currentDelivered });
      }
    }

    return [...metricMap.values()]
      .map((item) => {
        const weekly = item.days > 0 ? (item.sold / item.days) * 7 : 0;
        return { ...item, weekly, suggested: Math.max(1, Math.ceil(weekly)) };
      })
      .sort((a, b) => b.weekly - a.weekly);
  }, [reportVisits]);

  async function assignInvoiceToVisit() {
    if (!selectedVisit) return;
    const value = String(invoiceForm.invoiceNumber || "").trim();
    if (!value) return setError("Numero de factura obligatorio.");
    try {
      await apiPost(`/visits/${selectedVisit.id}/invoice`, { invoiceNumber: value });
      setInvoiceForm({ invoiceNumber: "" });
      await loadAll();
      setToast("Factura registrada y bloqueada");
    } catch (e) {
      setError(e.message || "No se pudo registrar factura");
    }
  }

  async function markVisitAsPaid(visitId) {
    try {
      await apiPost(`/visits/${visitId}/mark-paid`, {});
      await loadAll();
      setToast("Pago confirmado");
    } catch (e) {
      setError(e.message || "No se pudo marcar pago");
    }
  }

  function confirmMarkVisitAsPaid(visitId) {
    Alert.alert(
      "Confirmar pago",
      "Deseas marcar esta visita a credito como pagada? Esta accion actualiza la deuda del cliente.",
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Marcar pagado", style: "default", onPress: () => markVisitAsPaid(visitId) }
      ]
    );
  }

  async function deleteVisit(visitId) {
    try {
      await apiDelete(`/visits/${visitId}`);
      setSelectedVisitId("");
      await loadAll();
      setToast("Visita eliminada");
    } catch (e) {
      setError(e.message || "No se pudo eliminar visita");
    }
  }

  function confirmDeleteVisit(visitId) {
    Alert.alert(
      "Eliminar visita",
      "Esta accion elimina la visita y no se puede deshacer.",
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Eliminar", style: "destructive", onPress: () => deleteVisit(visitId) }
      ]
    );
  }

  const filteredVisits = useMemo(() => {
    const tradeNameQ = visitFilters.tradeName.trim().toLowerCase();
    const buyerNameQ = visitFilters.buyerName.trim().toLowerCase();
    const internalIdQ = visitFilters.internalId.trim().toLowerCase();
    const dateQ = visitFilters.date.trim();

    return data.visits
      .map((visit) => {
        const client = data.clients.find((c) => c.id === visit.clientId) || {};
        const seller = data.sellers.find((s) => s.id === visit.createdBySellerId);
        return {
          ...visit,
          clientName: client.tradeName || client.name || visit.prospectTradeName || "Prospecto",
          clientBuyer: client.buyerName || client.contact || visit.prospectBuyerName || "",
          clientInternalId: client.internalId || "",
          sellerName:
            visit.createdBySellerName ||
            (visit.createdBySellerId ? (seller?.name || "Vendedor") : "Admin")
        };
      })
      .filter((visit) => {
        if (tradeNameQ && !String(visit.clientName).toLowerCase().includes(tradeNameQ)) return false;
        if (buyerNameQ && !String(visit.clientBuyer).toLowerCase().includes(buyerNameQ)) return false;
        if (internalIdQ && !String(visit.clientInternalId).toLowerCase().includes(internalIdQ)) return false;
        if (dateQ && String(visit.date) !== dateQ) return false;
        return true;
      })
      .sort((a, b) => {
        const byName = String(a.clientName).localeCompare(String(b.clientName), "es", { sensitivity: "base" });
        if (byName !== 0) return byName;
        return new Date(b.date) - new Date(a.date);
      });
  }, [data.visits, data.clients, data.sellers, visitFilters]);

  const upcomingAppointments = useMemo(() => {
    const nowIso = today();
    return (data.appointments || [])
      .filter((appt) => String(appt.status || "") !== "done" && String(appt.date || "") >= nowIso)
      .map((appt) => {
        const client = data.clients.find((c) => c.id === appt.clientId);
        return {
          ...appt,
          clientName: client?.tradeName || client?.name || "Cliente",
          clientBuyer: client?.buyerName || client?.contact || "-"
        };
      })
      .sort((a, b) => new Date(a.date) - new Date(b.date));
  }, [data.appointments, data.clients]);

  const nextAppointmentByClient = useMemo(() => {
    const map = new Map();
    for (const appt of upcomingAppointments) {
      if (!map.has(appt.clientId)) map.set(appt.clientId, appt);
    }
    return map;
  }, [upcomingAppointments]);

  function updateClientForm(upd) {
    setClientForm((p) => {
      const n = { ...p, ...upd };
      n.location = [n.addressStreet, n.addressNumber, n.addressNeighborhood, n.addressCity, n.addressState].filter(Boolean).join(", ");
      return n;
    });
  }

  function openClientFormModal() {
    setClientForm({ ...CLIENT_FORM_INITIAL });
    setShowClientForm(true);
  }

  function closeClientFormModal() {
    setClientForm({ ...CLIENT_FORM_INITIAL });
    setShowClientForm(false);
  }

  function formatClientOption(client) {
    return `${client.internalId || client.id} - ${client.name}${client.buyer ? ` (${client.buyer})` : ""}`;
  }

  function selectVisitClient(client) {
    const lastVisit = data.visits
      .filter((v) => v.clientId === client.id)
      .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    const suggestedNext = lastVisit?.nextVisitDate
      ? String(lastVisit.nextVisitDate)
      : (lastVisit ? new Date(new Date(`${lastVisit.date}T00:00:00`).getTime() + 7 * 86400000).toISOString().slice(0, 10) : "");
    setVisitForm((p) => ({ ...p, clientId: client.id, nextVisitDate: p.nextVisitDate || suggestedNext }));
    setVisitClientQuery(formatClientOption(client));
    setShowClientSuggestions(false);
  }

  function selectVisitScheduleClient(client) {
    setVisitScheduleForm((prev) => ({ ...prev, clientId: client.id }));
    setVisitScheduleClientQuery(formatClientOption(client));
    setShowVisitScheduleClientSuggestions(false);
  }

  function selectReportClient(client) {
    setReportFilters((prev) => ({ ...prev, clientId: client.id }));
    setReportClientQuery(formatClientOption(client));
    setShowReportClientSuggestions(false);
  }

  function selectSalesClient(client) {
    setSalesFilters((prev) => ({ ...prev, clientId: client.id }));
    setSalesClientQuery(formatClientOption(client));
    setShowSalesClientSuggestions(false);
  }

  function onChangeNextVisitDate(_event, selectedDate) {
    setShowNextVisitPicker(false);
    if (!selectedDate) return;
    const iso = selectedDate.toISOString().slice(0, 10);
    setVisitForm((p) => ({ ...p, nextVisitDate: iso }));
  }

  function onChangeVisitDate(_event, selectedDate) {
    setShowVisitDatePicker(false);
    if (!selectedDate) return;
    setVisitForm((p) => ({ ...p, date: selectedDate.toISOString().slice(0, 10) }));
  }

  function onChangeScheduleDate(_event, selectedDate) {
    setShowScheduleDatePicker(false);
    if (!selectedDate) return;
    setScheduleForm((p) => ({ ...p, date: selectedDate.toISOString().slice(0, 10) }));
  }

  function onChangeVisitScheduleDate(_event, selectedDate) {
    setShowVisitScheduleDatePicker(false);
    if (!selectedDate) return;
    setVisitScheduleForm((p) => ({ ...p, date: selectedDate.toISOString().slice(0, 10) }));
  }

  function onChangeVisitFilterDate(_event, selectedDate) {
    setShowVisitFilterDatePicker(false);
    if (!selectedDate) return;
    setVisitFilters((p) => ({ ...p, date: selectedDate.toISOString().slice(0, 10) }));
  }

  function onChangeSalesDate(_event, selectedDate) {
    setShowSalesDatePicker(false);
    if (!selectedDate) return;
    setSalesFilters((p) => ({ ...p, date: selectedDate.toISOString().slice(0, 10) }));
  }

  function onChangeMovementDate(_event, selectedDate) {
    setShowMovementDatePicker(false);
    if (!selectedDate) return;
    setClientMovementForm((p) => ({ ...p, date: selectedDate.toISOString().slice(0, 10) }));
  }

  function selectVisitProduct(product) {
    setVisitItemDraft((prev) => ({
      ...prev,
      productId: product.id,
      productQuery: product.name,
      unitPrice: String(num(product.unitPrice || 0))
    }));
    setShowProductSuggestions(false);
  }

  function addVisitItem() {
    const productName = String(visitItemDraft.productQuery || "").trim();
    const quantity = visitEntryType === "count_only" ? 0 : num(visitItemDraft.quantity);
    const unitPrice = visitEntryType === "dispatch" ? num(visitItemDraft.unitPrice) : 0;
    if (visitEntryType !== "count_only" && !String(visitItemDraft.productId || "").trim()) {
      setError("Selecciona el producto desde la lista para descontar inventario correctamente.");
      return;
    }
    if (!productName || (visitEntryType !== "count_only" && quantity <= 0)) {
      setError(visitEntryType === "count_only" ? "Producto obligatorio." : "Producto y cantidad son obligatorios.");
      return;
    }
    const line = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      productId: visitItemDraft.productId || "",
      productName,
      quantity,
      unitPrice,
      total: quantity * unitPrice,
      remaining: null
    };
    setVisitItems((prev) => [...prev, line]);
    setVisitItemDraft({ productId: "", productQuery: "", quantity: "", unitPrice: "" });
    setShowProductSuggestions(false);
  }

  function removeVisitItem(lineId) {
    setVisitItems((prev) => prev.filter((line) => line.id !== lineId));
  }

  function updateVisitItemRemaining(lineId, text) {
    setVisitItems((prev) =>
      prev.map((line) => {
        if (line.id !== lineId) return line;
        const cleaned = String(text || "").trim();
        return { ...line, remaining: cleaned === "" ? null : num(cleaned) };
      })
    );
  }

  function getVisitValidationState() {
    const isDegustation = visitEntryType === "degustacion";
    const missingClient = !isDegustation && !visitForm.clientId;
    const missingProspect = isDegustation && !visitForm.clientId && !String(visitForm.prospectTradeName || "").trim();
    const missingDate = !visitForm.date;
    const missingItems = visitItems.length === 0;
    const missingAmount = !isDegustation && String(visitForm.amountCollected || "").trim() === "";
    const invalidCountSaleType = visitEntryType === "count_only" && visitForm.saleType === "consignado";
    const missingRemainingIds = new Set(
      (isDegustation ? [] : visitItems)
        .filter((item) => item.remaining === null || item.remaining === undefined)
        .map((item) => item.id)
    );
    return {
      missingClient,
      missingProspect,
      missingDate,
      missingItems,
      missingAmount,
      invalidCountSaleType,
      missingRemainingIds
    };
  }

  function getVisitValidationError() {
    const state = getVisitValidationState();
    if (state.missingDate) return "Fecha obligatoria.";
    if (state.missingClient) return "Cliente obligatorio para esta visita.";
    if (state.missingProspect) return "En degustacion debes seleccionar cliente o indicar nombre del comercio prospecto.";
    if (state.missingItems) return visitEntryType === "count_only" ? "Debes agregar al menos un producto para conteo." : "Debes agregar al menos un producto despachado.";
    if (state.invalidCountSaleType) return "En visita solo conteo, el tipo de cobro debe ser A vista o Boleto.";
    if (state.missingAmount) return "Cantidad recibida es obligatoria (usa 0 si no cobraste).";
    const missingRemaining = visitItems.find((item) => state.missingRemainingIds.has(item.id));
    if (missingRemaining) return `Falta 'restante' para ${missingRemaining.productName}.`;
    return "";
  }

  async function addProduct() {
    if (!productForm.name.trim()) return setError("Nombre de producto obligatorio.");
    try {
      await apiPost("/products", { name: productForm.name.trim(), unitPrice: num(productForm.unitPrice), ownProduction: productForm.ownProduction === true, active: true });
      setProductForm({ name: "", unitPrice: "", ownProduction: false });
      setShowProductForm(false);
      await loadAll();
      setToast("Producto creado");
    } catch (e) {
      setError(e.message || "No se pudo crear producto");
    }
  }

  async function toggleOwnProduction(product) {
    try {
      await apiPut(`/products/${product.id}`, { ownProduction: !(product.ownProduction === true) });
      await loadAll();
      setToast("Producto actualizado");
    } catch (e) {
      setError(e.message || "No se pudo actualizar producto");
    }
  }

  function openSellerDetail(overview) {
    setSelectedSellerId(overview.sellerId);
    setSellerClientFilter("");
    setSellerGoalsForm({
      weeklyGoal: String(num(overview.weeklyGoal)),
      monthlyGoal: String(num(overview.monthlyGoal)),
      commissionRate: String(num(overview.commissionRate))
    });
    setSellerStockForm({ productId: "", productName: "", quantity: "", notes: "" });
  }

  async function saveSellerGoals() {
    if (!selectedSellerOverview) return;
    try {
      await apiPost(`/sellers/${selectedSellerOverview.sellerId}/goals`, {
        weeklyGoal: num(sellerGoalsForm.weeklyGoal),
        monthlyGoal: num(sellerGoalsForm.monthlyGoal),
        commissionRate: num(sellerGoalsForm.commissionRate)
      });
      await loadAll();
      setToast("Metas del vendedor actualizadas");
    } catch (e) {
      setError(e.message || "No se pudo actualizar metas");
    }
  }

  async function saveSellerStock() {
    if (!selectedSellerOverview) return;
    if (!sellerStockForm.productName.trim()) return setError("Producto de stock obligatorio.");
    try {
      await apiPost(`/sellers/${selectedSellerOverview.sellerId}/stock`, {
        productId: sellerStockForm.productId || `manual_${sellerStockForm.productName.trim().toLowerCase().replace(/\s+/g, "_")}`,
        productName: sellerStockForm.productName.trim(),
        quantity: num(sellerStockForm.quantity),
        notes: sellerStockForm.notes || ""
      });
      setSellerStockForm({ productId: "", productName: "", quantity: "", notes: "" });
      await loadAll();
      setToast("Stock de vendedor actualizado");
    } catch (e) {
      setError(e.message || "No se pudo actualizar stock");
    }
  }

  async function manageSellerClient(clientId, mode) {
    if (!selectedSellerOverview) return;
    try {
      await apiPost(`/sellers/${selectedSellerOverview.sellerId}/clients/manage`, {
        clientId,
        mode
      });
      await loadAll();
      setToast(mode === "assign" ? "Cliente asignado" : "Cliente removido");
    } catch (e) {
      setError(e.message || "No se pudo actualizar asignacion de cliente");
    }
  }

  async function saveOwnerWeeklyGoal() {
    try {
      await apiPost("/settings/owner-goal", { ownerWeeklyGoal: num(ownerGoalForm.ownerWeeklyGoal) });
      await loadAll();
      setToast("Meta semanal del admin actualizada");
    } catch (e) {
      setError(e.message || "No se pudo actualizar meta semanal");
    }
  }

  async function saveOwnerProductGoal() {
    if (!ownerProductGoalForm.productName.trim()) return setError("Producto obligatorio para meta.");
    if (String(ownerProductGoalForm.targetQty).trim() === "") return setError("Cantidad objetivo obligatoria.");
    try {
      await apiPost("/product-goals/owner", {
        productId: ownerProductGoalForm.productId,
        productName: ownerProductGoalForm.productName.trim(),
        targetQty: num(ownerProductGoalForm.targetQty)
      });
      setOwnerProductGoalForm({ productId: "", productName: "", targetQty: "" });
      await loadAll();
      setToast("Meta por producto del admin actualizada");
    } catch (e) {
      setError(e.message || "No se pudo guardar meta por producto");
    }
  }

  async function saveInventoryItem() {
    if (!inventoryForm.productName.trim() || !inventoryForm.productId) return setError("Selecciona un producto para inventario.");
    try {
      await apiPost("/inventory", {
        productId: inventoryForm.productId,
        productName: inventoryForm.productName.trim(),
        quantity: num(inventoryForm.quantity)
      });
      setInventoryForm({ productId: "", productName: "", quantity: "" });
      await loadAll();
      setToast("Inventario actualizado");
    } catch (e) {
      setError(e.message || "No se pudo actualizar inventario");
    }
  }

  async function saveInventoryItemRow(item) {
    if (!item?.productId || !item?.productName) return setError("Producto invalido.");
    try {
      const draftValue = inventoryEditQty[item.id];
      const quantity = draftValue === undefined ? num(item.quantity) : num(draftValue);
      await apiPost("/inventory", {
        productId: item.productId,
        productName: String(item.productName).trim(),
        quantity
      });
      setInventoryEditQty((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      await loadAll();
      setToast("Cantidad de inventario actualizada");
    } catch (e) {
      setError(e.message || "No se pudo editar cantidad de inventario");
    }
  }

  async function transferInventoryToSeller() {
    if (!transferForm.sellerId || !transferForm.productId || num(transferForm.quantity) <= 0) {
      return setError("Selecciona vendedor, producto y cantidad para transferir.");
    }
    try {
      await apiPost("/inventory/transfer", {
        sellerId: transferForm.sellerId,
        productId: transferForm.productId,
        quantity: num(transferForm.quantity)
      });
      setTransferForm({ sellerId: "", productId: "", quantity: "" });
      await loadAll();
      setToast("Stock transferido al vendedor");
    } catch (e) {
      setError(e.message || "No se pudo transferir inventario");
    }
  }

  function addRecipeComponent() {
    const material = (data.rawMaterials || []).find((row) => row.id === recipeComponentDraft.materialId);
    const qty = num(recipeComponentDraft.qty);
    if (!material || qty <= 0) return setError("Selecciona materia prima y cantidad valida.");
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

  async function saveRawMaterial() {
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
      await loadAll();
      setToast("Materia prima guardada");
    } catch (e) {
      setError(e.message || "No se pudo guardar materia prima");
    }
  }

  async function saveRawMaterialRestock() {
    if (!restockForm.materialId) return setError("Selecciona materia prima.");
    if (num(restockForm.qtyAdded) <= 0) return setError("La cantidad debe ser mayor a 0.");
    try {
      await apiPost(`/production/raw-materials/${restockForm.materialId}/restock`, {
        qtyAdded: num(restockForm.qtyAdded),
        unitCost: num(restockForm.unitCost),
        date: restockForm.date || today(),
        supplier: restockForm.supplier || "",
        notes: restockForm.notes || ""
      });
      setRestockForm({ materialId: "", qtyAdded: "", unitCost: "", date: today(), supplier: "", notes: "" });
      await loadAll();
      setToast("Recarga guardada");
    } catch (e) {
      setError(e.message || "No se pudo guardar recarga");
    }
  }

  async function saveProductionRecipe() {
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
      await loadAll();
      setToast("Receta guardada");
    } catch (e) {
      setError(e.message || "No se pudo guardar receta");
    }
  }

  async function saveProductionBatch() {
    const product = (data.products || []).find((row) => row.id === batchForm.productId);
    if (!product) return setError("Producto obligatorio.");
    if (num(batchForm.outputQty) <= 0) return setError("Cantidad producida debe ser mayor a 0.");
    try {
      await apiPost("/production/batches", {
        date: batchForm.date || today(),
        productId: product.id,
        productName: product.name,
        outputQty: num(batchForm.outputQty),
        notes: batchForm.notes || ""
      });
      setBatchForm({ date: today(), productId: "", outputQty: "", notes: "" });
      await loadAll();
      setToast("Lote de produccion guardado");
    } catch (e) {
      setError(e.message || "No se pudo guardar lote");
    }
  }

  async function copyField(label, value) {
    const v = String(value || "").trim();
    if (!v) return setToast(`${label}: vazio`);
    await Clipboard.setStringAsync(v);
    setToast(`${label} copiado`);
  }

  async function copyReportSummary() {
    const lines = [
      "Reporte de distribuidora",
      `Ventas: ${reportSummary.totalSales.toFixed(2)}`,
      `Cobrado: ${reportSummary.totalCollected.toFixed(2)}`,
      `Pendiente: ${reportSummary.pendingTotal.toFixed(2)}`,
      `Vencido: ${reportSummary.overdueTotal.toFixed(2)}`,
      `Por vencer: ${reportSummary.upcomingTotal.toFixed(2)}`,
      "",
      "Top clientes:"
    ];
    for (const item of reportSummary.byClient.slice(0, 5)) {
      lines.push(`- ${item.clientName} (${item.internalId || "-"}) ventas ${num(item.sales).toFixed(2)} pendiente ${num(item.pending).toFixed(2)}`);
    }
    await Clipboard.setStringAsync(lines.join("\n"));
    setToast("Resumen copiado");
  }

  async function exportReportExcel() {
    const qs = new URLSearchParams();
    if (reportFilters.from) qs.set("from", reportFilters.from);
    if (reportFilters.to) qs.set("to", reportFilters.to);
    if (reportFilters.clientId) qs.set("clientId", reportFilters.clientId);
    if (reportFilters.saleType && reportFilters.saleType !== "all") qs.set("saleType", reportFilters.saleType);
    const base = API_BASE.replace(/\/api$/, "");
    const url = `${base}/api/reports/export-xlsx${qs.toString() ? `?${qs.toString()}` : ""}`;
    try {
      await Clipboard.setStringAsync(url);
      await Linking.openURL(url);
      setToast("Exportando Excel .xlsx");
    } catch {
      setToast("Link copiado para abrir en navegador");
    }
  }

  async function createServerBackup() {
    if (backupBusy) return;
    try {
      setBackupBusy(true);
      const result = await apiPost("/system/backup", {});
      setLastBackupFile(String(result.fileName || ""));
      setToast(`Backup OK: ${String(result.fileName || "")}`);
    } catch (e) {
      setError(e.message || "No se pudo crear backup");
    } finally {
      setBackupBusy(false);
    }
  }

  async function exportDbJson() {
    const base = API_BASE.replace(/\/api$/, "");
    const url = `${base}/api/system/db-export`;
    try {
      await Clipboard.setStringAsync(url);
      await Linking.openURL(url);
      setToast("Exportando JSON");
    } catch {
      setToast("Link JSON copiado");
    }
  }

  async function lookupCep() {
    const cep = digits(clientForm.cep);
    if (cep.length !== 8) return setError("CEP invalido");
    try {
      setLoadingCep(true); setError("");
      const d = await apiGet(`/lookup/cep/${cep}`);
      updateClientForm({ cep: d.cep || cep, addressStreet: d.street || clientForm.addressStreet, addressNeighborhood: d.neighborhood || clientForm.addressNeighborhood, addressCity: d.city || clientForm.addressCity, addressState: d.state || clientForm.addressState });
    } catch (e) { setError(e.message || "Error CEP"); } finally { setLoadingCep(false); }
  }

  async function lookupCnpj() {
    const cnpj = digits(clientForm.cnpj);
    if (cnpj.length !== 14) return setError("CNPJ invalido");
    try {
      setLoadingCnpj(true); setError("");
      const d = await apiGet(`/lookup/cnpj/${cnpj}`);
      updateClientForm({ cnpj, tradeName: d.tradeName || clientForm.tradeName, email: d.email || clientForm.email, phone: d.phone || clientForm.phone, ie: d.ie || clientForm.ie, cep: d.cep || clientForm.cep, addressStreet: d.street || clientForm.addressStreet, addressNumber: d.number || clientForm.addressNumber, addressNeighborhood: d.neighborhood || clientForm.addressNeighborhood, addressCity: d.city || clientForm.addressCity, addressState: d.state || clientForm.addressState });
    } catch (e) { setError(e.message || "Error CNPJ"); } finally { setLoadingCnpj(false); }
  }

  async function addClient() {
    if (!clientForm.tradeName.trim()) return setError("Nombre comercio obligatorio");
    if (clientForm.managedByType === "seller" && !clientForm.managedBySellerId) return setError("Selecciona vendedor");
    try {
      await apiPost("/clients", clientForm);
      setClientForm({ ...CLIENT_FORM_INITIAL });
      closeClientFormModal();
      await loadAll();
      setTab("clientes");
    } catch (e) { setError(e.message || "Error"); }
  }

  async function addClientMovement() {
    if (!selectedClient) return setError("Cliente no seleccionado.");
    if (savingMovement) return;
    if (!String(clientMovementForm.productName || "").trim()) return setError("Producto obligatorio en movimiento.");
    if (num(clientMovementForm.quantity) <= 0) return setError("Cantidad debe ser mayor a 0.");

    try {
      setSavingMovement(true);
      await apiPost(`/clients/${selectedClient.id}/movements`, {
        date: clientMovementForm.date || today(),
        type: clientMovementForm.type || "ajuste",
        productId: clientMovementForm.productId || "",
        productName: String(clientMovementForm.productName || "").trim(),
        quantity: num(clientMovementForm.quantity),
        notes: String(clientMovementForm.notes || "").trim()
      });
      setClientMovementForm({ date: today(), type: "ajuste", productId: "", productName: "", quantity: "", notes: "" });
      await loadAll();
      setToast("Movimiento registrado");
    } catch (e) {
      setError(e.message || "No se pudo registrar movimiento");
    } finally {
      setSavingMovement(false);
    }
  }

  async function addVisit() {
    const validationError = getVisitValidationError();
    if (validationError) {
      setError(validationError);
      Alert.alert("No se puede guardar", validationError);
      return;
    }
    try {
      const isDegustation = visitEntryType === "degustacion";
      const saleType = isDegustation ? "degustacion" : visitForm.saleType;
      const paymentType = isDegustation ? "degustacion" : (saleType === "a_vista" ? "contado" : "consignado");
      await apiPost("/visits", {
        ...visitForm,
        visitType: visitEntryType,
        saleType,
        paymentType,
        amountCollected: isDegustation ? 0 : num(visitForm.amountCollected),
        items: visitItems,
        delivered: visitEntryType === "count_only" ? 0 : visitTotals.totalQuantity,
        remaining: 0
      });
      setVisitForm({ date: today(), clientId: "", prospectTradeName: "", prospectBuyerName: "", prospectPhone: "", amountCollected: "", collectionMethod: "efectivo", saleType: "consignado", boletoDays: 7, nextVisitDate: "", notes: "" });
      setVisitItems([]);
      setVisitItemDraft({ productId: "", productQuery: "", quantity: "", unitPrice: "" });
      setVisitClientQuery("");
      setShowClientSuggestions(false);
      setVisitEntryType("dispatch");
      await loadAll(); setTab(selectedClientId ? "clientes" : "visitas");
    } catch (e) {
      const msg = e.message || "Error";
      setError(msg);
      Alert.alert("No se pudo guardar", msg);
    }
  }

  async function scheduleVisit() {
    if (!selectedClient || !scheduleForm.date) return;
    try {
      await apiPost("/appointments", { clientId: selectedClient.id, date: scheduleForm.date, notes: scheduleForm.notes });
      setShowSchedule(false); setScheduleForm({ date: today(), notes: "" }); await loadAll(); setToast("Visita agendada");
    } catch (e) { setError(e.message || "Error"); }
  }

  async function scheduleVisitFromVisits() {
    if (!visitScheduleForm.clientId || !visitScheduleForm.date) return setError("Cliente y fecha son obligatorios");
    try {
      await apiPost("/appointments", { clientId: visitScheduleForm.clientId, date: visitScheduleForm.date, notes: visitScheduleForm.notes });
      setShowVisitScheduleForm(false);
      setVisitScheduleForm({ clientId: "", date: today(), notes: "" });
      setVisitScheduleClientQuery("");
      setShowVisitScheduleClientSuggestions(false);
      await loadAll();
      setToast("Visita agendada");
    } catch (e) { setError(e.message || "Error"); }
  }

  function openRegisterVisit() {
    if (!selectedClient) return;
    const option = { id: selectedClient.id, internalId: selectedClient.internalId || "", name: selectedClient.tradeName || selectedClient.name || "Cliente", buyer: selectedClient.buyerName || selectedClient.contact || "" };
    setVisitEntryType("dispatch");
    setVisitForm((p) => ({ ...p, saleType: "consignado", collectionMethod: "", boletoDays: 7, prospectTradeName: "", prospectBuyerName: "", prospectPhone: "" }));
    setVisitForm((p) => ({ ...p, clientId: selectedClient.id, date: today() }));
    setVisitClientQuery(formatClientOption(option));
    setShowClientSuggestions(false);
    setShowActions(false);
    setTab("nuevaVisita");
  }
  function openRegisterVisitFromVisits() {
    setVisitEntryType("dispatch");
    setVisitForm((p) => ({ ...p, saleType: "consignado", collectionMethod: "", boletoDays: 7, prospectTradeName: "", prospectBuyerName: "", prospectPhone: "" }));
    setShowVisitsActions(false);
    setShowClientSuggestions(true);
    setTab("nuevaVisita");
  }
  function openCountOnlyVisitFromVisits() {
    setVisitEntryType("count_only");
    setVisitForm((p) => ({ ...p, saleType: "a_vista", collectionMethod: "efectivo", boletoDays: 7, prospectTradeName: "", prospectBuyerName: "", prospectPhone: "" }));
    setShowVisitsActions(false);
    setShowClientSuggestions(true);
    setTab("nuevaVisita");
  }
  function openDegustationVisitFromVisits() {
    setVisitEntryType("degustacion");
    setVisitForm((p) => ({ ...p, saleType: "degustacion", collectionMethod: "", boletoDays: 0, amountCollected: "0", prospectTradeName: "", prospectBuyerName: "", prospectPhone: "" }));
    setShowVisitsActions(false);
    setShowClientSuggestions(true);
    setTab("nuevaVisita");
  }

  function openVisitsReport() {
    if (!selectedClient) return;
    setVisitFilters({
      tradeName: selectedClient.tradeName || selectedClient.name || "",
      buyerName: selectedClient.buyerName || selectedClient.contact || "",
      internalId: selectedClient.internalId || "",
      date: ""
    });
    setShowActions(false);
    setShowVisitScheduleForm(false);
    setShowVisitsActions(false);
    setTab("visitas");
  }

  const Field = ({ label, value }) => (
    <View style={styles.row}>
      <View style={{ flex: 1 }}><Text style={styles.small}>{label}</Text><Text style={styles.bold}>{value || "-"}</Text></View>
      <Pressable style={styles.copy} onPress={() => copyField(label, value)}><Text style={styles.copyT}>Copiar</Text></Pressable>
    </View>
  );

  const visitValidation = getVisitValidationState();
  const visitValidationError = getVisitValidationError();
  const canSaveVisit = !visitValidationError;
  const panelWeekSummary = useMemo(() => {
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
      if (items.length === 0) continue;
      for (const item of items) {
        const name = String(item.productName || "Sin producto").trim() || "Sin producto";
        const current = byProduct.get(name) || { productName: name, quantity: 0, value: 0 };
        current.quantity += num(item.quantity);
        current.value += num(item.total || num(item.quantity) * num(item.unitPrice));
        byProduct.set(name, current);
      }
    }
    const products = [...byProduct.values()].sort((a, b) => b.value - a.value);
    return { totalValue, totalVista, totalConsignado, products };
  }, [data.visits]);

  const panelDebtSummary = useMemo(() => {
    const debtByClient = (data.clients || [])
      .map((client) => ({
        clientId: client.id,
        clientName: client.tradeName || client.name || "Cliente",
        debt: num(client.debt)
      }))
      .filter((item) => item.debt > 0)
      .sort((a, b) => b.debt - a.debt);
    const byProduct = new Map();
    for (const visit of data.visits || []) {
      const saleType = String(visit.saleType || "").toLowerCase();
      const paidByBoleto = saleType === "boleto" && !!visit.boletoPaid;
      const visitTotal = num(visit.totalValue ?? visit.soldAmount);
      const collected = num(visit.amountCollected);
      const pending = Math.max(0, paidByBoleto ? 0 : (visitTotal - collected));
      if (pending <= 0) continue;
      const items = Array.isArray(visit.items) ? visit.items : [];
      if (items.length === 0) {
        const key = "Sin detalle";
        byProduct.set(key, (byProduct.get(key) || 0) + pending);
        continue;
      }
      const itemsTotal = items.reduce((acc, item) => acc + num(item.total || num(item.quantity) * num(item.unitPrice)), 0);
      if (itemsTotal <= 0) {
        const key = "Sin detalle";
        byProduct.set(key, (byProduct.get(key) || 0) + pending);
        continue;
      }
      for (const item of items) {
        const key = String(item.productName || "Sin producto").trim() || "Sin producto";
        const itemTotal = num(item.total || num(item.quantity) * num(item.unitPrice));
        const share = pending * (itemTotal / itemsTotal);
        byProduct.set(key, (byProduct.get(key) || 0) + share);
      }
    }
    const debtByProduct = [...byProduct.entries()]
      .map(([productName, debt]) => ({ productName, debt }))
      .filter((item) => item.debt > 0)
      .sort((a, b) => b.debt - a.debt);
    return { debtByClient, debtByProduct };
  }, [data.clients, data.visits]);

  const degustationSummary = useMemo(() => {
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

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}><StatusBar style="dark" />
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "ios" ? 12 : 0}>
          <ScrollView
            contentContainerStyle={styles.wrap}
            keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#d96d20" />}
          >
          <View style={styles.card}>
            <View style={styles.heroLogoWrap}>
              <Image source={LOGO} style={styles.heroLogo} resizeMode="contain" />
            </View>
            <Text style={styles.k}>Control de Distribuidora</Text><Text style={styles.h}>Snack App</Text><Text style={styles.s}>API: {API_BASE}</Text>
          </View>

        <View style={styles.tabs}>{[["panel", "Panel"], ["clientes", "Clientes"], ["visitas", "Visitas"], ["ventas", "Ventas"], ["productos", "Productos"], ["inventario", "Inventario"], ["produccion", "Produccion"], ["vendedores", "Vendedores"], ["reportes", "Reportes"]].map(([id, t]) => <Pressable key={id} style={[styles.tab, tab === id && styles.tabA]} onPress={() => { setTab(id); setShowActions(false); setShowVisitsActions(false); setShowClientSuggestions(false); setShowProductSuggestions(false); setShowNextVisitPicker(false); setShowVisitDatePicker(false); setShowScheduleDatePicker(false); setShowVisitScheduleDatePicker(false); setShowVisitFilterDatePicker(false); setShowSalesDatePicker(false); setShowVisitScheduleClientSuggestions(false); setShowReportClientSuggestions(false); setShowSalesClientSuggestions(false); if (id !== "clientes") { setSelectedClientId(""); setSelectedClientSaleVisitId(""); setShowClientSalesList(false); } if (id !== "visitas") setSelectedVisitId(""); if (id !== "vendedores") setSelectedSellerId(""); }}><Text style={[styles.tabT, tab === id && styles.tabTA]}>{t}</Text></Pressable>)}</View>
        {error ? <Text style={styles.err}>{error}</Text> : null}
        {toast ? <Text style={styles.ok}>{toast}</Text> : null}
        {loading ? <ActivityIndicator size="large" color="#d96d20" style={{ marginTop: 20 }} /> : null}

        {!loading && tab === "panel" && (
          <>
            <View style={styles.grid}>
              <Pressable style={[styles.box, { backgroundColor: "#ffe7c8" }]} onPress={() => setShowPanelWeekDetails((p) => !p)}>
                <View style={styles.panelRow}>
                  <Text>Vendido esta semana</Text>
                  <Text style={styles.panelExpand}>{showPanelWeekDetails ? "Ocultar" : "Ver detalle"}</Text>
                </View>
                <Text style={styles.big}>{money(panelWeekSummary.totalValue)}</Text>
                <Text style={styles.s}>Productos vendidos: {panelWeekSummary.products.length}</Text>
                <Text style={styles.s}>A vista: {money(panelWeekSummary.totalVista)} | Consignado: {money(panelWeekSummary.totalConsignado)}</Text>
                {showPanelWeekDetails ? (
                  <View style={styles.panelDetailBox}>
                    {panelWeekSummary.products.length === 0 ? <Text style={styles.s}>Sin ventas esta semana.</Text> : null}
                    {panelWeekSummary.products.map((item) => (
                      <View key={`week_${item.productName}`} style={styles.panelDetailRow}>
                        <Text style={styles.panelDetailName}>{item.productName}</Text>
                        <Text style={styles.panelDetailValue}>{num(item.quantity).toFixed(2)} unid | {money(item.value)}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </Pressable>
              <Pressable style={[styles.box, { backgroundColor: "#dff4ef" }]} onPress={() => setShowPanelDebtDetails((p) => !p)}>
                <View style={styles.panelRow}>
                  <Text>Deuda total</Text>
                  <Text style={styles.panelExpand}>{showPanelDebtDetails ? "Ocultar" : "Ver detalle"}</Text>
                </View>
                <Text style={styles.big}>{money(data.dashboard.totalDebt)}</Text>
                <Text style={styles.s}>Clientes con deuda: {panelDebtSummary.debtByClient.length}</Text>
                {showPanelDebtDetails ? (
                  <View style={styles.panelDetailBox}>
                    <Text style={styles.panelDetailTitle}>Deuda por producto</Text>
                    {panelDebtSummary.debtByProduct.length === 0 ? <Text style={styles.s}>Sin deuda por producto.</Text> : null}
                    {panelDebtSummary.debtByProduct.map((item) => (
                      <View key={`debt_prod_${item.productName}`} style={styles.panelDetailRow}>
                        <Text style={styles.panelDetailName}>{item.productName}</Text>
                        <Text style={styles.panelDetailValue}>{money(item.debt)}</Text>
                      </View>
                    ))}
                    <Text style={[styles.panelDetailTitle, { marginTop: 8 }]}>Deuda por cliente</Text>
                    {panelDebtSummary.debtByClient.length === 0 ? <Text style={styles.s}>Sin deuda por cliente.</Text> : null}
                    {panelDebtSummary.debtByClient.map((item) => (
                      <View key={`debt_client_${item.clientId}`} style={styles.panelDetailRow}>
                        <Text style={styles.panelDetailName}>{item.clientName}</Text>
                        <Text style={styles.panelDetailValue}>{money(item.debt)}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </Pressable>
              <View style={[styles.box, { backgroundColor: "#e9f8db" }]}><Text>Clientes por visitar</Text><Text style={styles.big}>{data.dashboard.clientsNeedingVisit.length}</Text></View>
            </View>
            <View style={styles.card}>
              <Text style={styles.t}>Meta del admin por producto</Text>
              <TextInput style={styles.i} placeholder="Producto" value={ownerProductGoalForm.productName} onChangeText={(t) => setOwnerProductGoalForm((p) => ({ ...p, productName: t, productId: "" }))} />
              <View style={styles.quick}>
                {(data.products || []).slice(0, 8).map((p) => (
                  <Pressable key={p.id} style={styles.quickBtn} onPress={() => setOwnerProductGoalForm((d) => ({ ...d, productId: p.id, productName: p.name }))}>
                    <Text style={styles.quickTxt}>{p.name}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput style={styles.i} placeholder="Cantidad objetivo semanal (unid)" value={ownerProductGoalForm.targetQty} onChangeText={(t) => setOwnerProductGoalForm((p) => ({ ...p, targetQty: t }))} keyboardType="decimal-pad" />
              <Pressable style={styles.btn} onPress={saveOwnerProductGoal}><Text style={styles.btnT}>Guardar meta por producto</Text></Pressable>
              {(data.ownerProductGoalProgress || []).map((g) => (
                <Text key={g.id} style={styles.s}>{g.productName}: meta {num(g.targetQty).toFixed(2)} unid | vendido {num(g.soldQty).toFixed(2)} unid | faltante {num(g.remainingQty).toFixed(2)} unid</Text>
              ))}
            </View>
          </>
        )}

        {!loading && tab === "clientes" && !selectedClientId && <>
          {data.clients.map((c) => {
            const computed = Array.isArray(c.productAvailability) && c.productAvailability.length > 0 ? c.productAvailability : computeAvailabilityFromVisits(data.visits, c.id);
            const availabilityPreview = computed.slice(0, 2);
            return (
              <Pressable key={c.id} style={styles.card} onPress={() => { setSelectedClientId(c.id); setShowClientSalesList(false); setSelectedClientSaleVisitId(""); setShowClientAccount(false); setClientMovementForm({ date: today(), type: "ajuste", productId: "", productName: "", quantity: "", notes: "" }); }}>
                <Text style={styles.t}>{c.tradeName || c.name}</Text>
                <Text style={styles.s}>ID interno: {c.internalId || "-"}</Text>
                <Text style={styles.s}>{c.type} | {c.location || "Sin ubicacion"}</Text>
                <Text style={styles.s}>Atendido por: {c.managedByName || "Propietario"}</Text>
                {availabilityPreview.map((item, idx) => (
                  <Text key={`${c.id}_av_${idx}`} style={styles.s}>
                    Disponible {item.productName}: {num(item.availableQty).toFixed(2)} unid ({availabilitySourceLabel(item.source)})
                  </Text>
                ))}
                <Text style={styles.debt}>Deuda: {num(c.debt).toFixed(2)}</Text>
              </Pressable>
            );
          })}

        </>}

        {!loading && tab === "clientes" && !!selectedClientId && selectedClient && <>
          <View style={styles.card}><Pressable style={styles.copy} onPress={() => { setSelectedClientId(""); setSelectedClientSaleVisitId(""); setShowClientSalesList(false); setShowClientAccount(false); setShowActions(false); setShowSchedule(false); setClientMovementForm({ date: today(), type: "ajuste", productId: "", productName: "", quantity: "", notes: "" }); }}><Text style={styles.copyT}>Volver</Text></Pressable><Text style={styles.h2}>{selectedClient.tradeName || selectedClient.name}</Text></View>
          <View style={styles.card}><Text style={styles.t}>1. Informacion del cliente</Text>
            <Field label="ID interno" value={selectedClient.internalId} /><Field label="Responsable" value={selectedClient.buyerName || selectedClient.contact} /><Field label="Telefono" value={selectedClient.phone} /><Field label="Correo" value={selectedClient.email} /><Field label="CPF" value={selectedClient.cpf} /><Field label="CNPJ" value={selectedClient.cnpj} /><Field label="IE" value={selectedClient.ie} /><Field label="CEP" value={selectedClient.cep} /><Field label="Direccion" value={selectedClient.location} /><Field label="Tipo" value={selectedClient.type} /><Field label="Atendido por" value={selectedClient.managedByName} /><Field label="Observaciones" value={selectedClient.observations} />
            <Text style={styles.tSection}>Disponibilidad actual (cliente)</Text>
            {selectedClientAvailability.map((item, idx) => (
              <View key={`${selectedClient.id}_pa_${idx}`} style={styles.itemLine}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.dropdownTitle}>{item.productName}</Text>
                  <Text style={styles.dropdownSub}>Disponible: {num(item.availableQty).toFixed(2)} unid</Text>
                  <Text style={styles.dropdownSub}>Base: {availabilitySourceLabel(item.source)} | Actualizado: {fmt(item.lastUpdated)}</Text>
                </View>
              </View>
            ))}
            {selectedClientAvailability.length === 0 ? <Text style={styles.s}>Sin datos de conteo/estimado por producto.</Text> : null}
          </View>
          <View style={styles.card}>
            <Text style={styles.t}>Cambios del cliente (vencido, danado, devolucion, ajuste)</Text>
            <Pressable style={styles.i} onPress={() => setShowMovementDatePicker(true)}>
              <Text style={styles.datePickerText}>{clientMovementForm.date ? `Fecha: ${clientMovementForm.date}` : "Seleccionar fecha"}</Text>
            </Pressable>
            {showMovementDatePicker && (
              <DateTimePicker
                value={clientMovementForm.date ? new Date(`${clientMovementForm.date}T00:00:00`) : new Date()}
                mode="date"
                display="default"
                onChange={onChangeMovementDate}
              />
            )}
            <Text style={styles.s}>Tipo de cambio</Text>
            <View style={styles.tabs}>
              {[["vencido", "Vencido"], ["danado", "Danado"], ["devolucion", "Devolucion"], ["ajuste", "Ajuste"], ["otro", "Otro"]].map(([id, label]) => (
                <Pressable key={id} style={[styles.tab, clientMovementForm.type === id && styles.tabA]} onPress={() => setClientMovementForm((p) => ({ ...p, type: id }))}>
                  <Text style={[styles.tabT, clientMovementForm.type === id && styles.tabTA]}>{label}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              style={styles.i}
              placeholder="Producto"
              value={clientMovementForm.productName}
              onChangeText={(t) => setClientMovementForm((p) => ({ ...p, productName: t, productId: "" }))}
            />
            <View style={styles.quick}>
              {(data.products || []).slice(0, 10).map((p) => (
                <Pressable
                  key={`mov_prod_${p.id}`}
                  style={styles.quickBtn}
                  onPress={() => setClientMovementForm((d) => ({ ...d, productId: p.id, productName: p.name }))}
                >
                  <Text style={styles.quickTxt}>{p.name}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              style={styles.i}
              placeholder="Cantidad (unid)"
              keyboardType="decimal-pad"
              value={clientMovementForm.quantity}
              onChangeText={(t) => setClientMovementForm((p) => ({ ...p, quantity: t }))}
            />
            <TextInput
              style={styles.i}
              placeholder="Motivo / nota"
              value={clientMovementForm.notes}
              onChangeText={(t) => setClientMovementForm((p) => ({ ...p, notes: t }))}
            />
            <Pressable style={[styles.btn, savingMovement && styles.btnDisabled]} onPress={addClientMovement} disabled={savingMovement}>
              <Text style={styles.btnT}>{savingMovement ? "Guardando..." : "Registrar cambio"}</Text>
            </Pressable>
            <Text style={styles.tSection}>Historial de cambios</Text>
            {selectedClientMovements.slice(0, 30).map((movement) => (
              <View key={movement.id} style={styles.itemLine}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.dropdownTitle}>{movement.date} | {String(movement.type || "").toUpperCase()}</Text>
                  <Text style={styles.dropdownSub}>{movement.productName} - {num(movement.quantity).toFixed(2)} unid</Text>
                  {movement.notes ? <Text style={styles.dropdownSub}>{movement.notes}</Text> : null}
                </View>
              </View>
            ))}
            {selectedClientMovements.length === 0 ? <Text style={styles.s}>Sin cambios registrados para este cliente.</Text> : null}
          </View>
          <Pressable style={styles.card} onPress={openVisitsReport}>
            <Text style={styles.t}>2. Relatorio de visitas</Text>
            <Text style={styles.s}>Ultima visita: {fmt(sales?.last?.date)}</Text>
            <Text style={styles.s}>Proxima sugerida/agendada: {fmt(sales?.next)}</Text>
            {clientAppts.slice(0, 3).map((a) => <Text key={a.id} style={styles.s}>Agendada: {fmt(a.date)} {a.notes ? `- ${a.notes}` : ""}</Text>)}
            <View style={styles.quick}>
              <Pressable style={styles.quickBtn} onPress={openVisitsReport}><Text style={styles.quickTxt}>Ir a visitas</Text></Pressable>
              <Pressable style={styles.quickBtn} onPress={() => setShowSchedule((p) => !p)}><Text style={styles.quickTxt}>Agendar visita</Text></Pressable>
            </View>
          </Pressable>
          <Pressable style={styles.card} onPress={() => { setShowClientSalesList((prev) => !prev); setSelectedClientSaleVisitId(""); }}>
            <Text style={styles.t}>3. Relatorio de ventas</Text>
            <Text style={styles.s}>Historico vendido: {num(sales?.sold).toFixed(2)}</Text>
            <Text style={styles.s}>Promedio semanal: {num(sales?.avg).toFixed(2)}</Text>
            <Text style={styles.s}>Vendido ultima semana: {num(sales?.sold7).toFixed(2)}</Text>
            <Text style={styles.s}>Sugerencia despacho: {num(sales?.dispatch).toFixed(0)} bolsas</Text>
            <Text style={styles.s}>{showClientSalesList ? "Tocar para cerrar" : "Tocar para ver ventas por fecha"}</Text>
          </Pressable>

          {showClientSalesList && !selectedClientSaleVisitId && (
            <View style={styles.card}>
              <Text style={styles.t}>Ventas por fecha</Text>
              {clientVisits.map((visit) => {
                const total = num(visit.totalValue ?? visit.soldAmount);
                const collected = num(visit.amountCollected);
                const status = collected >= total ? "Cobrado" : collected > 0 ? "Parcial" : "Pendiente";
                return (
                  <Pressable key={visit.id} style={styles.itemLine} onPress={() => setSelectedClientSaleVisitId(visit.id)}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.dropdownTitle}>{visit.date}</Text>
                      <Text style={styles.dropdownSub}>Total: {total.toFixed(2)} | Cobrado: {collected.toFixed(2)}</Text>
                      <Text style={styles.dropdownSub}>Tipo: {visit.saleType || visit.paymentType} | Estado: {status}</Text>
                    </View>
                  </Pressable>
                );
              })}
              {clientVisits.length === 0 ? <Text style={styles.s}>Sin ventas registradas.</Text> : null}
            </View>
          )}

          {showClientSalesList && !!selectedClientSaleVisitId && selectedClientSaleVisit && (
            <View style={styles.card}>
              <Pressable style={styles.copy} onPress={() => setSelectedClientSaleVisitId("")}><Text style={styles.copyT}>Volver a lista de ventas</Text></Pressable>
              <Text style={styles.t}>Detalle de venta</Text>
              <Text style={styles.s}>Fecha: {selectedClientSaleVisit.date}</Text>
              <Text style={styles.s}>Tipo: {selectedClientSaleVisit.saleType || selectedClientSaleVisit.paymentType}</Text>
              <Text style={styles.s}>Total: {num(selectedClientSaleVisit.totalValue ?? selectedClientSaleVisit.soldAmount).toFixed(2)}</Text>
              <Text style={styles.s}>Cobrado: {num(selectedClientSaleVisit.amountCollected).toFixed(2)}</Text>
              <Text style={styles.s}>Factura: {selectedClientSaleVisit.invoiceNumber || "Sin factura"}</Text>
              {(Array.isArray(selectedClientSaleVisit.items) ? selectedClientSaleVisit.items : []).map((item, idx) => (
                <View key={`${selectedClientSaleVisit.id}_${idx}`} style={styles.itemLine}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.dropdownTitle}>{item.productName}</Text>
                    <Text style={styles.dropdownSub}>Cant: {num(item.quantity).toFixed(2)} | Valor: {num(item.unitPrice).toFixed(2)} | Total: {num(item.total).toFixed(2)}</Text>
                    <Text style={styles.dropdownSub}>Restante para cálculo: {item.remaining === null || item.remaining === undefined ? "-" : num(item.remaining).toFixed(2)}</Text>
                  </View>
                </View>
              ))}
              {(!Array.isArray(selectedClientSaleVisit.items) || selectedClientSaleVisit.items.length === 0) ? <Text style={styles.s}>Sin detalle de productos (registro anterior).</Text> : null}
            </View>
          )}
          <Pressable style={styles.card} onPress={() => setShowClientAccount((prev) => !prev)}>
            <Text style={styles.t}>4. Estado de cuenta</Text>
            <Text style={styles.s}>Estado: {num(selectedClient.debt) <= 0 ? "Al dia" : "Con deuda"}</Text>
            <Text style={styles.s}>Deuda actual: {num(selectedClient.debt).toFixed(2)}</Text>
            <Text style={styles.s}>Total recaudado: {num(accountSummary?.totalCollected).toFixed(2)}</Text>
            <Text style={styles.s}>{showClientAccount ? "Tocar para cerrar" : "Tocar para abrir detalle de cuenta"}</Text>
          </Pressable>

          {showClientAccount && accountSummary && (
            <View style={styles.card}>
              <Text style={styles.t}>Resumen de cuenta</Text>
              <Text style={styles.s}>Riesgo: {accountSummary.risk}</Text>
              <Text style={styles.s}>Saldo vencido: {num(accountSummary.overdueAmount).toFixed(2)}</Text>
              <Text style={styles.s}>Saldo por vencer: {num(accountSummary.upcomingAmount).toFixed(2)}</Text>
              <Text style={styles.s}>Dias sin pago: {accountSummary.daysWithoutPayment ?? "-"}</Text>

              <Text style={styles.tSection}>Pagos realizados</Text>
              {accountSummary.payments.slice(0, 20).map((p) => (
                <View key={p.id} style={styles.itemLine}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.dropdownTitle}>{p.date}</Text>
                    <Text style={styles.dropdownSub}>Pago: {num(p.amount).toFixed(2)}</Text>
                  </View>
                </View>
              ))}
              {accountSummary.payments.length === 0 ? <Text style={styles.s}>Sin pagos registrados.</Text> : null}

              <Text style={styles.tSection}>Montos adquiridos</Text>
              {accountSummary.acquisitions.slice(0, 30).map((a) => (
                <View key={a.id} style={styles.itemLine}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.dropdownTitle}>{a.date}</Text>
                    <Text style={styles.dropdownSub}>Monto: {num(a.amount).toFixed(2)} | Tipo: {a.saleType}</Text>
                  </View>
                </View>
              ))}
              {accountSummary.acquisitions.length === 0 ? <Text style={styles.s}>Sin adquisiciones registradas.</Text> : null}

              <Text style={styles.tSection}>Boletos</Text>
              {accountSummary.boletos.map((b) => (
                <View key={b.id} style={styles.itemLine}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.dropdownTitle}>{b.date} | {b.status}</Text>
                    <Text style={styles.dropdownSub}>Monto: {num(b.amount).toFixed(2)} | Vence: {b.dueDate || "-"}</Text>
                  </View>
                  {b.status !== "Pagado" ? (
                    <Pressable style={styles.copy} onPress={() => confirmMarkVisitAsPaid(b.id)}>
                      <Text style={styles.copyT}>Marcar pagado</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}
              {accountSummary.boletos.length === 0 ? <Text style={styles.s}>Sin boletos registrados.</Text> : null}
            </View>
          )}
        </>}

        {!loading && tab === "visitas" && !selectedVisitId && <>
          <View style={styles.card}>
            <Text style={styles.t}>Filtros de visitas</Text>
            <TextInput style={styles.i} placeholder="Nombre comercio" value={visitFilters.tradeName} onChangeText={(t) => setVisitFilters((p) => ({ ...p, tradeName: t }))} />
            <TextInput style={styles.i} placeholder="Nombre responsable" value={visitFilters.buyerName} onChangeText={(t) => setVisitFilters((p) => ({ ...p, buyerName: t }))} />
            <TextInput style={styles.i} placeholder="ID interno" value={visitFilters.internalId} onChangeText={(t) => setVisitFilters((p) => ({ ...p, internalId: t }))} />
            <Pressable style={styles.i} onPress={() => setShowVisitFilterDatePicker(true)}>
              <Text style={styles.datePickerText}>{visitFilters.date ? `Fecha: ${visitFilters.date}` : "Seleccionar fecha (calendario)"}</Text>
            </Pressable>
            {showVisitFilterDatePicker && (
              <DateTimePicker
                value={visitFilters.date ? new Date(`${visitFilters.date}T00:00:00`) : new Date()}
                mode="date"
                display="default"
                onChange={onChangeVisitFilterDate}
              />
            )}
            <Pressable style={styles.copy} onPress={() => setVisitFilters({ tradeName: "", buyerName: "", internalId: "", date: "" })}><Text style={styles.copyT}>Limpiar filtros</Text></Pressable>
          </View>
          <View style={styles.card}>
            <Text style={styles.t}>Visitas agendadas a futuro</Text>
            {upcomingAppointments.slice(0, 20).map((appt) => (
              <View key={appt.id} style={styles.itemLine}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.dropdownTitle}>{appt.clientName}</Text>
                  <Text style={styles.dropdownSub}>Fecha: {appt.date} | Responsable: {appt.clientBuyer}</Text>
                  {appt.notes ? <Text style={styles.dropdownSub}>Notas: {appt.notes}</Text> : null}
                </View>
              </View>
            ))}
            {upcomingAppointments.length === 0 ? <Text style={styles.s}>No hay visitas agendadas a futuro.</Text> : null}
          </View>
          {filteredVisits.map((v) => (
            <Pressable key={v.id} style={styles.card} onPress={() => { setSelectedVisitId(v.id); setInvoiceForm({ invoiceNumber: String(v.invoiceNumber || "") }); }}>
              <Text style={styles.t}>{v.clientName}</Text>
              <Text style={styles.s}>Responsable: {v.clientBuyer || "-"}</Text>
              <Text style={styles.s}>ID interno: {v.clientInternalId || "-"}</Text>
              <Text style={styles.s}>Registrado por: {v.sellerName || "Admin"}</Text>
              <Text style={styles.s}>{v.date} | {v.paymentType}</Text>
              <Text style={styles.s}>Proxima visita: {v.nextVisitDate || nextAppointmentByClient.get(v.clientId)?.date || "-"}</Text>
              <Text style={styles.s}>Unidades {num(v.soldUnits ?? v.delivered).toFixed(2)} | Valor {num(v.totalValue ?? v.soldAmount).toFixed(2)}</Text>
              <Text style={styles.s}>Factura: {String(v.invoiceNumber || "").trim() ? v.invoiceNumber : "Sin factura"}</Text>
            </Pressable>
          ))}
          {filteredVisits.length === 0 ? <View style={styles.card}><Text style={styles.s}>No hay visitas con esos filtros.</Text></View> : null}
        </>}

        {!loading && tab === "visitas" && !!selectedVisitId && selectedVisit && (
          <>
            <View style={styles.card}>
              <Pressable style={styles.copy} onPress={() => setSelectedVisitId("")}><Text style={styles.copyT}>Volver a visitas</Text></Pressable>
              <Text style={styles.h2}>Detalle de visita</Text>
              <Text style={styles.s}>Cliente: {selectedVisitClient?.tradeName || selectedVisitClient?.name || selectedVisit.prospectTradeName || "Prospecto"}</Text>
              {!selectedVisitClient && selectedVisit.prospectBuyerName ? <Text style={styles.s}>Responsable prospecto: {selectedVisit.prospectBuyerName}</Text> : null}
              <Text style={styles.s}>Fecha: {selectedVisit.date}</Text>
              <Text style={styles.s}>Registrado por: {selectedVisit.createdBySellerName || (selectedVisit.createdBySellerId ? "Vendedor" : "Admin")}</Text>
              <Text style={styles.s}>Tipo venta: {selectedVisit.saleType || selectedVisit.paymentType}</Text>
              {selectedVisit.saleType === "boleto" ? <Text style={styles.s}>Boleto: {selectedVisit.boletoDays || "-"} dias | Vence: {selectedVisit.dueDate || "-"}</Text> : null}
              <Text style={styles.s}>Cobrado: {num(selectedVisit.amountCollected).toFixed(2)}</Text>
              <Text style={styles.s}>Proxima visita: {selectedVisit.nextVisitDate || "-"}</Text>
              <Text style={styles.s}>Notas: {selectedVisit.notes || "-"}</Text>
              {(() => {
                const saleType = String(selectedVisit.saleType || selectedVisit.paymentType || "").toLowerCase();
                const total = num(selectedVisit.totalValue ?? selectedVisit.soldAmount);
                const pending = Math.max(0, total - num(selectedVisit.amountCollected));
                const canMarkPaid = (saleType === "consignado" || saleType === "boleto") && pending > 0;
                return (
                  <View style={styles.rowWrap}>
                    {canMarkPaid ? (
                      <Pressable style={styles.copy} onPress={() => confirmMarkVisitAsPaid(selectedVisit.id)}>
                        <Text style={styles.copyT}>Marcar pagado</Text>
                      </Pressable>
                    ) : null}
                    <Pressable style={[styles.copy, styles.copyDanger]} onPress={() => confirmDeleteVisit(selectedVisit.id)}>
                      <Text style={[styles.copyT, styles.copyDangerText]}>Eliminar visita</Text>
                    </Pressable>
                  </View>
                );
              })()}
            </View>

            <View style={styles.card}>
              <Text style={styles.t}>Productos de la visita</Text>
              {(Array.isArray(selectedVisit.items) ? selectedVisit.items : []).map((item, idx) => (
                <View key={`${selectedVisit.id}_${idx}`} style={styles.itemLine}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.dropdownTitle}>{item.productName}</Text>
                    <Text style={styles.dropdownSub}>Cant: {num(item.quantity).toFixed(2)} | Valor: {num(item.unitPrice).toFixed(2)} | Total: {num(item.total).toFixed(2)}</Text>
                    <Text style={styles.dropdownSub}>Restante para cálculo: {item.remaining === null || item.remaining === undefined ? "-" : num(item.remaining).toFixed(2)}</Text>
                  </View>
                </View>
              ))}
              {(!Array.isArray(selectedVisit.items) || selectedVisit.items.length === 0) ? <Text style={styles.s}>Sin detalle de productos (visita antigua).</Text> : null}
            </View>

            <View style={styles.card}>
              <Text style={styles.t}>Factura emitida</Text>
              <Text style={styles.s}>Estado: {selectedVisit.invoiceLocked || String(selectedVisit.invoiceNumber || "").trim() ? "Bloqueada" : "Pendiente"}</Text>
              {selectedVisit.invoiceLocked || String(selectedVisit.invoiceNumber || "").trim()
                ? <Text style={styles.s}>Numero factura: {selectedVisit.invoiceNumber}</Text>
                : <>
                    <TextInput style={styles.i} placeholder="Numero de factura" value={invoiceForm.invoiceNumber} onChangeText={(t) => setInvoiceForm({ invoiceNumber: t })} />
                    <Pressable style={styles.btn} onPress={assignInvoiceToVisit}><Text style={styles.btnT}>Guardar factura (bloquear)</Text></Pressable>
                  </>}
            </View>
          </>
        )}

        {!loading && tab === "productos" && <>
          {data.products
            .slice()
            .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "es", { sensitivity: "base" }))
            .map((product) => (
              <View key={product.id} style={styles.card}>
                <Text style={styles.t}>{product.name}</Text>
                <Text style={styles.s}>Precio sugerido: {num(product.unitPrice).toFixed(2)}</Text>
                <Text style={styles.s}>Estado: {product.active === false ? "Inactivo" : "Activo"}</Text>
                <Text style={styles.s}>Produccion propia: {product.ownProduction ? "Si" : "No"}</Text>
                <Pressable style={styles.copy} onPress={() => toggleOwnProduction(product)}><Text style={styles.copyT}>{product.ownProduction ? "Quitar produccion propia" : "Marcar produccion propia"}</Text></Pressable>
              </View>
            ))}
          {data.products.length === 0 ? <View style={styles.card}><Text style={styles.s}>Aun no hay productos.</Text></View> : null}
          {showProductForm && (
            <View style={styles.card}>
              <Text style={styles.t}>Nuevo producto</Text>
              <TextInput style={styles.i} placeholder="Nombre del producto" value={productForm.name} onChangeText={(t) => setProductForm((p) => ({ ...p, name: t }))} />
              <TextInput style={styles.i} placeholder="Precio sugerido" value={productForm.unitPrice} onChangeText={(t) => setProductForm((p) => ({ ...p, unitPrice: t }))} />
              <Pressable style={styles.copy} onPress={() => setProductForm((p) => ({ ...p, ownProduction: !p.ownProduction }))}><Text style={styles.copyT}>{productForm.ownProduction ? "Produccion propia: SI" : "Produccion propia: NO"}</Text></Pressable>
              <Pressable style={styles.btn} onPress={addProduct}><Text style={styles.btnT}>Guardar producto</Text></Pressable>
            </View>
          )}
        </>}

        {!loading && tab === "inventario" && (
          <>
            <View style={styles.card}>
              <Text style={styles.t}>Inventario general</Text>
              {(data.inventory || []).map((item) => (
                <View key={item.id} style={styles.itemLine}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.dropdownTitle}>{item.productName}</Text>
                    <Text style={styles.dropdownSub}>Disponible: {num(item.quantity).toFixed(2)} unid</Text>
                  </View>
                  <View style={styles.invRowActions}>
                    <TextInput
                      style={styles.invQtyInput}
                      placeholder="Editar"
                      value={String(inventoryEditQty[item.id] ?? num(item.quantity))}
                      onChangeText={(t) => setInventoryEditQty((prev) => ({ ...prev, [item.id]: t }))}
                      keyboardType="decimal-pad"
                    />
                    <Pressable style={styles.btnMini} onPress={() => saveInventoryItemRow(item)}>
                      <Text style={styles.btnT}>Editar</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
              {(data.inventory || []).length === 0 ? <Text style={styles.s}>Sin inventario cargado.</Text> : null}
            </View>

            <View style={styles.card}>
              <Text style={styles.t}>Cargar inventario</Text>
              <View style={styles.dropdown}>
                {(data.products || []).slice(0, 20).map((product) => (
                  <Pressable
                    key={product.id}
                    style={[styles.dropdownItem, inventorySelectedProductId === product.id && styles.dropdownItemSelected]}
                    onPress={() => {
                      setInventorySelectedProductId(product.id);
                      setInventoryForm({ productId: product.id, productName: product.name, quantity: "" });
                    }}
                  >
                    <Text style={styles.dropdownTitle}>{product.name}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput style={styles.i} placeholder="Producto" value={inventoryForm.productName} onChangeText={(t) => setInventoryForm((p) => ({ ...p, productName: t, productId: "" }))} />
              <TextInput style={styles.i} placeholder="Cantidad disponible (unid)" value={inventoryForm.quantity} onChangeText={(t) => setInventoryForm((p) => ({ ...p, quantity: t }))} keyboardType="decimal-pad" />
              <Pressable style={styles.btn} onPress={saveInventoryItem}><Text style={styles.btnT}>Guardar inventario</Text></Pressable>
            </View>

            <View style={styles.card}>
              <Text style={styles.t}>Asignar stock a vendedor</Text>
              <Text style={styles.s}>1. Selecciona vendedor</Text>
              <View style={styles.tabs}>
                {sellers.map((s) => (
                  <Pressable key={s.id} style={[styles.tab, transferForm.sellerId === s.id && styles.tabA]} onPress={() => setTransferForm((p) => ({ ...p, sellerId: s.id }))}>
                    <Text style={[styles.tabT, transferForm.sellerId === s.id && styles.tabTA]}>{s.name}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.s}>2. Selecciona producto</Text>
              <View style={styles.dropdown}>
                {(data.inventory || []).filter((i) => num(i.quantity) > 0).map((item) => (
                  <Pressable
                    key={item.id}
                    style={[styles.dropdownItem, transferForm.productId === item.productId && styles.dropdownItemSelected]}
                    onPress={() => setTransferForm((p) => ({ ...p, productId: item.productId }))}
                  >
                    <Text style={styles.dropdownTitle}>{item.productName}</Text>
                    <Text style={styles.dropdownSub}>Disponible: {num(item.quantity).toFixed(2)} unid</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.s}>3. Cantidad a transferir</Text>
              <TextInput style={styles.i} placeholder="Cantidad (unid)" value={transferForm.quantity} onChangeText={(t) => setTransferForm((p) => ({ ...p, quantity: t }))} keyboardType="decimal-pad" />
              <Pressable style={styles.btn} onPress={transferInventoryToSeller}><Text style={styles.btnT}>Transferir stock</Text></Pressable>
            </View>
          </>
        )}

        {!loading && tab === "produccion" && (
          <>
            <View style={styles.card}>
              <Text style={styles.t}>Producto de produccion propia</Text>
              <View style={styles.dropdown}>
                {ownProductionProducts.map((product) => (
                  <Pressable
                    key={`own_production_${product.id}`}
                    style={[styles.dropdownItem, productionProductId === product.id && styles.dropdownItemSelected]}
                    onPress={() => {
                      setProductionProductId(product.id);
                      setRecipeForm((p) => ({ ...p, productId: product.id }));
                      setBatchForm((p) => ({ ...p, productId: product.id }));
                      setProductionOpen({ raw: false, recipe: false, cost: false, batch: false });
                    }}
                  >
                    <Text style={styles.dropdownTitle}>{product.name}</Text>
                  </Pressable>
                ))}
              </View>
              {!selectedProductionProduct ? <Text style={styles.s}>Selecciona un producto propio para ver sus datos de produccion.</Text> : <>
                <Text style={styles.s}>Sugerencia semanal</Text>
                <Text style={styles.big}>{num(selectedProductionSummary?.suggestedProduction || 0).toFixed(2)} unid</Text>
                <Text style={styles.s}>Demanda: {num(selectedProductionSummary?.weekDemandQty || 0).toFixed(2)} | Stock: {num(selectedProductionSummary?.currentStock || 0).toFixed(2)}</Text>
                <View style={styles.tabs}>
                  <Pressable style={[styles.tab, productionOpen.raw && styles.tabA]} onPress={() => setProductionOpen((s) => ({ ...s, raw: !s.raw }))}><Text style={[styles.tabT, productionOpen.raw && styles.tabTA]}>Materia prima</Text></Pressable>
                  <Pressable style={[styles.tab, productionOpen.recipe && styles.tabA]} onPress={() => setProductionOpen((s) => ({ ...s, recipe: !s.recipe }))}><Text style={[styles.tabT, productionOpen.recipe && styles.tabTA]}>Receta</Text></Pressable>
                  <Pressable style={[styles.tab, productionOpen.cost && styles.tabA]} onPress={() => setProductionOpen((s) => ({ ...s, cost: !s.cost }))}><Text style={[styles.tabT, productionOpen.cost && styles.tabTA]}>Costos</Text></Pressable>
                  <Pressable style={[styles.tab, productionOpen.batch && styles.tabA]} onPress={() => setProductionOpen((s) => ({ ...s, batch: !s.batch }))}><Text style={[styles.tabT, productionOpen.batch && styles.tabTA]}>Lote</Text></Pressable>
                </View>
              </>}
            </View>

            {selectedProductionProduct ? <View style={styles.grid}>
              <View style={[styles.box, { backgroundColor: "#ffe7c8" }]}><Text>Compra MP sugerida</Text><Text style={styles.big}>{money(num(data.productionSummary?.totalEstimatedBuyCost))}</Text></View>
            </View> : null}

            {selectedProductionProduct && productionOpen.raw ? <View style={styles.card}>
              <Text style={styles.t}>Nueva materia prima</Text>
              <TextInput style={styles.i} placeholder="Nombre materia prima" value={rawMaterialForm.name} onChangeText={(t) => setRawMaterialForm((p) => ({ ...p, name: t }))} />
              <TextInput style={styles.i} placeholder="Unidad (kg, L, unid)" value={rawMaterialForm.unit} onChangeText={(t) => setRawMaterialForm((p) => ({ ...p, unit: t }))} />
              <TextInput style={styles.i} placeholder="Stock inicial" value={rawMaterialForm.stockQty} onChangeText={(t) => setRawMaterialForm((p) => ({ ...p, stockQty: t }))} keyboardType="decimal-pad" />
              <TextInput style={styles.i} placeholder="Costo inicial por unidad (R$)" value={rawMaterialForm.costPerUnit} onChangeText={(t) => setRawMaterialForm((p) => ({ ...p, costPerUnit: t }))} keyboardType="decimal-pad" />
              <Text style={styles.s}>Asociar a producto</Text>
              <View style={styles.dropdown}>
                {(data.products || []).map((product) => (
                  <Pressable
                    key={`raw_product_${product.id}`}
                    style={[styles.dropdownItem, rawMaterialProductDraft === product.id && styles.dropdownItemSelected]}
                    onPress={() => setRawMaterialProductDraft(product.id)}
                  >
                    <Text style={styles.dropdownTitle}>{product.name}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable style={styles.copy} onPress={addRawMaterialProductAssociation}><Text style={styles.copyT}>Asociar producto</Text></Pressable>
              {(rawMaterialForm.appliesToProductIds || []).map((productId) => {
                const productName = (data.products || []).find((p) => p.id === productId)?.name || productId;
                return (
                  <View key={`raw_association_${productId}`} style={styles.itemLine}>
                    <Text style={styles.dropdownTitle}>{productName}</Text>
                    <Pressable style={styles.btnMini} onPress={() => removeRawMaterialProductAssociation(productId)}><Text style={styles.btnT}>Quitar</Text></Pressable>
                  </View>
                );
              })}
              <Pressable style={styles.btn} onPress={saveRawMaterial}><Text style={styles.btnT}>Guardar materia prima</Text></Pressable>
              {(data.rawMaterials || []).map((row) => (
                <View key={row.id} style={styles.itemLine}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.dropdownTitle}>{row.name} ({row.unit})</Text>
                    <Text style={styles.dropdownSub}>Stock: {num(row.stockQty).toFixed(2)} | Costo prom: {money(row.costPerUnit)}</Text>
                    <Text style={styles.dropdownSub}>
                      Productos: {(row.appliesToProductIds || []).map((id) => (data.products || []).find((p) => p.id === id)?.name || id).join(", ") || "Sin asociar"}
                    </Text>
                  </View>
                </View>
              ))}
              {(data.rawMaterials || []).length === 0 ? <Text style={styles.s}>Sin materias primas cargadas.</Text> : null}
            </View> : null}

            {selectedProductionProduct && productionOpen.raw ? <View style={styles.card}>
              <Text style={styles.t}>Recargar materia prima</Text>
              <View style={styles.dropdown}>
                {(data.rawMaterials || []).map((row) => (
                  <Pressable
                    key={`restock_material_${row.id}`}
                    style={[styles.dropdownItem, restockForm.materialId === row.id && styles.dropdownItemSelected]}
                    onPress={() => setRestockForm((p) => ({ ...p, materialId: row.id }))}
                  >
                    <Text style={styles.dropdownTitle}>{row.name}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable style={styles.i} onPress={() => setShowScheduleDatePicker(true)}>
                <Text style={styles.datePickerText}>{restockForm.date ? `Fecha recarga: ${restockForm.date}` : "Seleccionar fecha"}</Text>
              </Pressable>
              {showScheduleDatePicker && (
                <DateTimePicker
                  value={restockForm.date ? new Date(`${restockForm.date}T00:00:00`) : new Date()}
                  mode="date"
                  display="default"
                  onChange={(_event, selectedDate) => {
                    setShowScheduleDatePicker(false);
                    if (!selectedDate) return;
                    setRestockForm((p) => ({ ...p, date: selectedDate.toISOString().slice(0, 10) }));
                  }}
                />
              )}
              <TextInput style={styles.i} placeholder="Cantidad recargada" value={restockForm.qtyAdded} onChangeText={(t) => setRestockForm((p) => ({ ...p, qtyAdded: t }))} keyboardType="decimal-pad" />
              <TextInput style={styles.i} placeholder="Costo por unidad (R$)" value={restockForm.unitCost} onChangeText={(t) => setRestockForm((p) => ({ ...p, unitCost: t }))} keyboardType="decimal-pad" />
              <TextInput style={styles.i} placeholder="Proveedor" value={restockForm.supplier} onChangeText={(t) => setRestockForm((p) => ({ ...p, supplier: t }))} />
              <TextInput style={styles.i} placeholder="Notas" value={restockForm.notes} onChangeText={(t) => setRestockForm((p) => ({ ...p, notes: t }))} />
              <Pressable style={styles.btn} onPress={saveRawMaterialRestock}><Text style={styles.btnT}>Guardar recarga</Text></Pressable>
              {(data.rawMaterialRestocks || []).slice(0, 20).map((row) => (
                <View key={row.id} style={styles.itemLine}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.dropdownTitle}>{row.materialName} ({fmt(row.date)})</Text>
                    <Text style={styles.dropdownSub}>+{num(row.qtyAdded).toFixed(2)} {row.unit} | {money(row.unitCost)}</Text>
                    <Text style={styles.dropdownSub}>Stock: {num(row.previousStockQty).toFixed(2)} -> {num(row.newStockQty).toFixed(2)}</Text>
                  </View>
                  <Text style={styles.dropdownSub}>{money(row.totalCost)}</Text>
                </View>
              ))}
              {(data.rawMaterialRestocks || []).length === 0 ? <Text style={styles.s}>Sin recargas registradas.</Text> : null}
            </View> : null}

            {selectedProductionProduct && productionOpen.recipe ? <View style={styles.card}>
              <Text style={styles.t}>Receta por producto</Text>
              <View style={styles.dropdown}>
                {(data.products || []).map((product) => (
                  <Pressable
                    key={`prod_recipe_${product.id}`}
                    style={[styles.dropdownItem, recipeForm.productId === product.id && styles.dropdownItemSelected]}
                    onPress={() => setRecipeForm((p) => ({ ...p, productId: product.id }))}
                  >
                    <Text style={styles.dropdownTitle}>{product.name}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput style={styles.i} placeholder="Rendimiento receta (unid)" value={recipeForm.yieldQty} onChangeText={(t) => setRecipeForm((p) => ({ ...p, yieldQty: t }))} keyboardType="decimal-pad" />
              <Text style={styles.s}>Agregar materia prima a la receta</Text>
              <View style={styles.dropdown}>
                {(data.rawMaterials || []).map((row) => (
                  <Pressable
                    key={`mat_recipe_${row.id}`}
                    style={[styles.dropdownItem, recipeComponentDraft.materialId === row.id && styles.dropdownItemSelected]}
                    onPress={() => setRecipeComponentDraft((p) => ({ ...p, materialId: row.id }))}
                  >
                    <Text style={styles.dropdownTitle}>{row.name}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput style={styles.i} placeholder="Cantidad por receta" value={recipeComponentDraft.qty} onChangeText={(t) => setRecipeComponentDraft((p) => ({ ...p, qty: t }))} keyboardType="decimal-pad" />
              <Pressable style={styles.copy} onPress={addRecipeComponent}><Text style={styles.copyT}>Agregar componente</Text></Pressable>
              {recipeComponents.map((row) => (
                <View key={`recipe_comp_${row.materialId}`} style={styles.itemLine}>
                  <Text style={styles.dropdownTitle}>{row.materialName}</Text>
                  <View style={styles.invRowActions}>
                    <Text style={styles.dropdownSub}>{num(row.qty).toFixed(4)}</Text>
                    <Pressable style={styles.btnMini} onPress={() => removeRecipeComponent(row.materialId)}><Text style={styles.btnT}>Quitar</Text></Pressable>
                  </View>
                </View>
              ))}
              <Pressable style={styles.btn} onPress={saveProductionRecipe}><Text style={styles.btnT}>Guardar receta</Text></Pressable>
              {selectedProductionRecipe ? <Text style={styles.s}>Receta actual para producto seleccionado: rendimiento {num(selectedProductionRecipe.yieldQty).toFixed(2)} unid.</Text> : null}
            </View> : null}

            {selectedProductionProduct && productionOpen.batch ? <View style={styles.card}>
              <Text style={styles.t}>Registrar lote de produccion</Text>
              <Pressable style={styles.i} onPress={() => setShowVisitDatePicker(true)}>
                <Text style={styles.datePickerText}>{batchForm.date ? `Fecha lote: ${batchForm.date}` : "Seleccionar fecha"}</Text>
              </Pressable>
              {showVisitDatePicker && (
                <DateTimePicker
                  value={batchForm.date ? new Date(`${batchForm.date}T00:00:00`) : new Date()}
                  mode="date"
                  display="default"
                  onChange={(_event, selectedDate) => {
                    setShowVisitDatePicker(false);
                    if (!selectedDate) return;
                    setBatchForm((p) => ({ ...p, date: selectedDate.toISOString().slice(0, 10) }));
                  }}
                />
              )}
              <View style={styles.dropdown}>
                {(data.products || []).map((product) => (
                  <Pressable
                    key={`prod_batch_${product.id}`}
                    style={[styles.dropdownItem, batchForm.productId === product.id && styles.dropdownItemSelected]}
                    onPress={() => setBatchForm((p) => ({ ...p, productId: product.id }))}
                  >
                    <Text style={styles.dropdownTitle}>{product.name}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput style={styles.i} placeholder="Cantidad producida (unid)" value={batchForm.outputQty} onChangeText={(t) => setBatchForm((p) => ({ ...p, outputQty: t }))} keyboardType="decimal-pad" />
              <TextInput style={styles.i} placeholder="Notas" value={batchForm.notes} onChangeText={(t) => setBatchForm((p) => ({ ...p, notes: t }))} />
              <Pressable style={styles.btn} onPress={saveProductionBatch}><Text style={styles.btnT}>Guardar lote</Text></Pressable>
              {(data.productionBatches || []).slice(0, 12).map((batch) => (
                <View key={batch.id} style={styles.itemLine}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.dropdownTitle}>{batch.productName}</Text>
                    <Text style={styles.dropdownSub}>{batch.date} | {num(batch.outputQty).toFixed(2)} unid</Text>
                  </View>
                  <Text style={styles.dropdownSub}>{money(batch.unitCost)}/unid</Text>
                </View>
              ))}
              {(data.productionBatches || []).length === 0 ? <Text style={styles.s}>Sin lotes registrados.</Text> : null}
            </View> : null}

            {selectedProductionProduct && productionOpen.cost ? <View style={styles.card}>
              <Text style={styles.t}>Costos de produccion</Text>
              {(data.productionSummary?.averageUnitCostByProduct || [])
                .filter((row) => String(row.productId || "") === selectedProductionProduct.id)
                .map((row) => (
                  <View key={`prod_cost_${row.productId || row.productName}`} style={styles.itemLine}>
                    <Text style={styles.dropdownTitle}>{row.productName}</Text>
                    <Text style={styles.dropdownSub}>{money(num(row.avgUnitCost))}/unid</Text>
                  </View>
                ))}
              {(data.productionSummary?.averageUnitCostByProduct || []).filter((row) => String(row.productId || "") === selectedProductionProduct.id).length === 0 ? <Text style={styles.s}>Aun sin costo promedio para este producto.</Text> : null}
            </View> : null}
          </>
        )}

        {!loading && tab === "vendedores" && !selectedSellerId && (
          <>
            {data.sellerOverview.map((overview) => (
              <Pressable key={overview.sellerId} style={styles.card} onPress={() => openSellerDetail(overview)}>
                <Text style={styles.t}>{overview.sellerName}</Text>
                <Text style={styles.s}>Clientes: {overview.totalClients} | Deuda: {num(overview.totalDebt).toFixed(2)}</Text>
                <Text style={styles.s}>Ventas semana: {num(overview.weekSales).toFixed(2)} | Mes: {num(overview.monthSales).toFixed(2)}</Text>
                <Text style={styles.s}>Meta semana: {num(overview.weeklyGoal).toFixed(2)} | Faltante: {num(overview.weekGoalRemaining).toFixed(2)} ({num(overview.weekGoalProgressPct).toFixed(1)}%)</Text>
                <Text style={styles.s}>Comisión mes: {num(overview.commissionAmount).toFixed(2)} ({num(overview.commissionRate).toFixed(2)}%)</Text>
                <Text style={styles.s}>Agenda semanal: {overview.scheduleWeek.length} visitas | Stock: {num(overview.stockUnits).toFixed(2)} unid</Text>
              </Pressable>
            ))}
            {data.sellerOverview.length === 0 ? <View style={styles.card}><Text style={styles.s}>Aun no hay vendedores activos.</Text></View> : null}
          </>
        )}

        {!loading && tab === "vendedores" && !!selectedSellerId && selectedSellerOverview && (
          <>
            <View style={styles.card}>
              <Pressable style={styles.copy} onPress={() => setSelectedSellerId("")}><Text style={styles.copyT}>Volver</Text></Pressable>
              <Text style={styles.h2}>{selectedSellerOverview.sellerName}</Text>
              <Text style={styles.s}>Clientes: {selectedSellerOverview.totalClients}</Text>
              <Text style={styles.s}>Ventas semana: {num(selectedSellerOverview.weekSales).toFixed(2)}</Text>
              <Text style={styles.s}>Meta semana: {num(selectedSellerOverview.weeklyGoal).toFixed(2)} | Faltante: {num(selectedSellerOverview.weekGoalRemaining).toFixed(2)} ({num(selectedSellerOverview.weekGoalProgressPct).toFixed(1)}%)</Text>
              <Text style={styles.s}>Ventas mes: {num(selectedSellerOverview.monthSales).toFixed(2)}</Text>
              <Text style={styles.s}>Comisión mes: {num(selectedSellerOverview.commissionAmount).toFixed(2)}</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.t}>Metas y comisión</Text>
              <TextInput style={styles.i} placeholder="Meta semanal (R$)" value={sellerGoalsForm.weeklyGoal} onChangeText={(t) => setSellerGoalsForm((p) => ({ ...p, weeklyGoal: t }))} keyboardType="decimal-pad" />
              <TextInput style={styles.i} placeholder="Meta mensual (R$)" value={sellerGoalsForm.monthlyGoal} onChangeText={(t) => setSellerGoalsForm((p) => ({ ...p, monthlyGoal: t }))} keyboardType="decimal-pad" />
              <TextInput style={styles.i} placeholder="Comisión (%)" value={sellerGoalsForm.commissionRate} onChangeText={(t) => setSellerGoalsForm((p) => ({ ...p, commissionRate: t }))} keyboardType="decimal-pad" />
              <Pressable style={styles.btn} onPress={saveSellerGoals}><Text style={styles.btnT}>Guardar metas</Text></Pressable>
            </View>

            <View style={styles.card}>
              <Text style={styles.t}>Clientes asignados</Text>
              {selectedSellerOverview.assignedClients.map((client) => (
                <View key={client.id} style={styles.itemLine}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.dropdownTitle}>{client.tradeName}</Text>
                    <Text style={styles.dropdownSub}>{client.internalId || client.id} | Responsable: {client.buyerName || "-"}</Text>
                    <Text style={styles.dropdownSub}>Deuda: {num(client.debt).toFixed(2)}</Text>
                  </View>
                  <Pressable style={styles.quickBtn} onPress={() => manageSellerClient(client.id, "remove")}>
                    <Text style={styles.quickTxt}>Quitar</Text>
                  </Pressable>
                </View>
              ))}
              {selectedSellerOverview.assignedClients.length === 0 ? <Text style={styles.s}>Sin clientes asignados.</Text> : null}
            </View>

            <View style={styles.card}>
              <Text style={styles.t}>Asignar clientes</Text>
              <TextInput
                style={styles.i}
                placeholder="Buscar por comercio, responsable o ID"
                value={sellerClientFilter}
                onChangeText={setSellerClientFilter}
              />
              {sellerAssignableClients.slice(0, 40).map((client) => (
                <View key={client.id} style={styles.itemLine}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.dropdownTitle}>{client.tradeName || client.name || "Cliente"}</Text>
                    <Text style={styles.dropdownSub}>{client.internalId || client.id} | Responsable: {client.buyerName || client.contact || "-"}</Text>
                    <Text style={styles.dropdownSub}>Actualmente: {client.managedByName || "Propietario"}</Text>
                  </View>
                  <Pressable style={styles.quickBtn} onPress={() => manageSellerClient(client.id, "assign")}>
                    <Text style={styles.quickTxt}>Asignar</Text>
                  </Pressable>
                </View>
              ))}
              {sellerAssignableClients.length === 0 ? <Text style={styles.s}>No hay clientes disponibles con ese filtro.</Text> : null}
            </View>

            <View style={styles.card}>
              <Text style={styles.t}>Pagos por método</Text>
              {Object.entries(selectedSellerOverview.paymentsByMethod || {}).map(([method, amount]) => (
                <Text key={method} style={styles.s}>{method}: {num(amount).toFixed(2)}</Text>
              ))}
              {Object.keys(selectedSellerOverview.paymentsByMethod || {}).length === 0 ? <Text style={styles.s}>Sin pagos registrados.</Text> : null}
            </View>

            <View style={styles.card}>
              <Text style={styles.t}>Stock de pronta entrega</Text>
              {selectedSellerOverview.stock.map((item) => (
                <View key={item.id} style={styles.itemLine}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.dropdownTitle}>{item.productName}</Text>
                    <Text style={styles.dropdownSub}>Stock: {num(item.quantity).toFixed(2)} unid | Actualizado: {fmt(item.updatedAt?.slice?.(0, 10) || "")}</Text>
                  </View>
                </View>
              ))}
              {selectedSellerOverview.stock.length === 0 ? <Text style={styles.s}>Sin stock cargado.</Text> : null}

              <Text style={styles.tSection}>Actualizar stock</Text>
              <View style={styles.selectorShell}>
                <TextInput
                  style={styles.selectorInput}
                  placeholder="Producto"
                  value={sellerStockForm.productName}
                  onChangeText={(t) => setSellerStockForm((p) => ({ ...p, productName: t, productId: "" }))}
                />
              </View>
              <View style={styles.dropdown}>
                {visitProductOptions.slice(0, 8).map((product) => (
                  <Pressable key={product.id} style={styles.dropdownItem} onPress={() => setSellerStockForm((p) => ({ ...p, productId: product.id, productName: product.name }))}>
                    <Text style={styles.dropdownTitle}>{product.name}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput style={styles.i} placeholder="Cantidad en stock" value={sellerStockForm.quantity} onChangeText={(t) => setSellerStockForm((p) => ({ ...p, quantity: t }))} keyboardType="decimal-pad" />
              <TextInput style={styles.i} placeholder="Notas stock" value={sellerStockForm.notes} onChangeText={(t) => setSellerStockForm((p) => ({ ...p, notes: t }))} />
              <Pressable style={styles.btn} onPress={saveSellerStock}><Text style={styles.btnT}>Guardar stock</Text></Pressable>
            </View>

            <View style={styles.card}>
              <Text style={styles.t}>Agenda semanal</Text>
              {selectedSellerOverview.scheduleWeek.map((appt) => (
                <View key={appt.id} style={styles.itemLine}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.dropdownTitle}>{appt.date} - {appt.clientName}</Text>
                    <Text style={styles.dropdownSub}>{appt.clientInternalId || appt.clientId} {appt.notes ? `| ${appt.notes}` : ""}</Text>
                  </View>
                </View>
              ))}
              {selectedSellerOverview.scheduleWeek.length === 0 ? <Text style={styles.s}>Sin agenda en próximos 7 días.</Text> : null}
            </View>

            <View style={styles.card}>
              <Text style={styles.t}>Histórico de visitas</Text>
              {selectedSellerOverview.visitHistory.slice(0, 30).map((visit) => (
                <View key={visit.id} style={styles.itemLine}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.dropdownTitle}>{visit.date} - {visit.clientName}</Text>
                    <Text style={styles.dropdownSub}>Total: {num(visit.totalValue ?? visit.soldAmount).toFixed(2)} | Cobrado: {num(visit.amountCollected).toFixed(2)}</Text>
                  </View>
                </View>
              ))}
              {selectedSellerOverview.visitHistory.length === 0 ? <Text style={styles.s}>Sin visitas registradas.</Text> : null}
            </View>
          </>
        )}

        {!loading && tab === "ventas" && (
          <>
            <View style={styles.card}>
              <Text style={styles.t}>Ventas (detalle)</Text>
              <Pressable style={styles.i} onPress={() => setShowSalesDatePicker(true)}>
                <Text style={styles.datePickerText}>{salesFilters.date ? `Fecha: ${salesFilters.date}` : "Sin filtro de fecha"}</Text>
              </Pressable>
              {showSalesDatePicker && (
                <DateTimePicker
                  value={salesFilters.date ? new Date(`${salesFilters.date}T00:00:00`) : new Date()}
                  mode="date"
                  display="default"
                  onChange={onChangeSalesDate}
                />
              )}

              <View style={styles.selectorShell}>
                <TextInput
                  style={styles.selectorInput}
                  placeholder="Filtrar por cliente"
                  placeholderTextColor="#9aa0ad"
                  value={salesClientQuery}
                  onChangeText={(t) => {
                    setSalesClientQuery(t);
                    setSalesFilters((p) => ({ ...p, clientId: "" }));
                  }}
                />
                <Pressable
                  style={styles.selectorBtn}
                  onPress={() => {
                    setSalesClientQuery("");
                    setSalesFilters((p) => ({ ...p, clientId: "" }));
                    setShowSalesClientSuggestions(false);
                  }}
                >
                  <Text style={styles.selectorBtnTxt}>X</Text>
                </Pressable>
                <Pressable style={styles.selectorBtn} onPress={() => setShowSalesClientSuggestions((p) => !p)}>
                  <Text style={styles.selectorBtnTxt}>{showSalesClientSuggestions ? "^" : "v"}</Text>
                </Pressable>
              </View>
              {showSalesClientSuggestions && (
                <View style={styles.dropdown}>
                  {filteredSalesClientOptions.slice(0, 12).map((client) => (
                    <Pressable key={client.id} style={styles.dropdownItem} onPress={() => selectSalesClient(client)}>
                      <Text style={styles.dropdownTitle}>{client.name}</Text>
                      <Text style={styles.dropdownSub}>{client.internalId || client.id} | {client.buyer || "-"}</Text>
                    </Pressable>
                  ))}
                  {filteredSalesClientOptions.length === 0 ? <Text style={styles.s}>Sin clientes con ese filtro.</Text> : null}
                </View>
              )}

              <Text style={styles.s}>Filtrar por vendedor</Text>
              <View style={styles.tabs}>
                <Pressable style={[styles.tab, salesFilters.sellerId === "" && styles.tabA]} onPress={() => setSalesFilters((p) => ({ ...p, sellerId: "" }))}><Text style={[styles.tabT, salesFilters.sellerId === "" && styles.tabTA]}>Todos</Text></Pressable>
                <Pressable style={[styles.tab, salesFilters.sellerId === "admin" && styles.tabA]} onPress={() => setSalesFilters((p) => ({ ...p, sellerId: "admin" }))}><Text style={[styles.tabT, salesFilters.sellerId === "admin" && styles.tabTA]}>Admin</Text></Pressable>
                {sellers.map((seller) => (
                  <Pressable key={`sales_seller_${seller.id}`} style={[styles.tab, salesFilters.sellerId === seller.id && styles.tabA]} onPress={() => setSalesFilters((p) => ({ ...p, sellerId: seller.id }))}>
                    <Text style={[styles.tabT, salesFilters.sellerId === seller.id && styles.tabTA]}>{seller.name}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.s}>Tipo de venta</Text>
              <View style={styles.tabs}>
                <Pressable style={[styles.tab, salesFilters.saleType === "all" && styles.tabA]} onPress={() => setSalesFilters((p) => ({ ...p, saleType: "all" }))}><Text style={[styles.tabT, salesFilters.saleType === "all" && styles.tabTA]}>Todos</Text></Pressable>
                <Pressable style={[styles.tab, salesFilters.saleType === "a_vista" && styles.tabA]} onPress={() => setSalesFilters((p) => ({ ...p, saleType: "a_vista" }))}><Text style={[styles.tabT, salesFilters.saleType === "a_vista" && styles.tabTA]}>A vista</Text></Pressable>
                <Pressable style={[styles.tab, salesFilters.saleType === "consignado" && styles.tabA]} onPress={() => setSalesFilters((p) => ({ ...p, saleType: "consignado" }))}><Text style={[styles.tabT, salesFilters.saleType === "consignado" && styles.tabTA]}>Consignado</Text></Pressable>
                <Pressable style={[styles.tab, salesFilters.saleType === "boleto" && styles.tabA]} onPress={() => setSalesFilters((p) => ({ ...p, saleType: "boleto" }))}><Text style={[styles.tabT, salesFilters.saleType === "boleto" && styles.tabTA]}>Boleto</Text></Pressable>
              </View>

              <View style={styles.quick}>
                <Pressable style={styles.copy} onPress={() => { setSalesFilters({ date: today(), clientId: "", sellerId: "", saleType: "all" }); setSalesClientQuery(""); setShowSalesClientSuggestions(false); }}><Text style={styles.copyT}>Hoy</Text></Pressable>
                <Pressable style={styles.copy} onPress={() => { setSalesFilters({ date: "", clientId: "", sellerId: "", saleType: "all" }); setSalesClientQuery(""); setShowSalesClientSuggestions(false); }}><Text style={styles.copyT}>Limpiar</Text></Pressable>
              </View>
            </View>

            <View style={styles.grid}>
              <View style={[styles.box, { backgroundColor: "#ffe7c8" }]}><Text>Vendido</Text><Text style={styles.big}>{money(salesSummary.totalSales)}</Text></View>
              <View style={[styles.box, { backgroundColor: "#dff4ef" }]}><Text>Cobrado</Text><Text style={styles.big}>{money(salesSummary.totalCollected)}</Text></View>
              <View style={[styles.box, { backgroundColor: "#ffe5d9" }]}><Text>Pendiente</Text><Text style={styles.big}>{money(salesSummary.totalPending)}</Text></View>
            </View>

            <View style={styles.card}>
              <Text style={styles.t}>Lista de ventas</Text>
              {salesRows.map((row) => (
                <View key={`sale_${row.id}`} style={styles.itemLine}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.dropdownTitle}>{row.clientName}</Text>
                    <Text style={styles.dropdownSub}>{row.date} | {row.saleType} | {row.sellerName}</Text>
                    <Text style={styles.dropdownSub}>Total: {money(row.totalValue)} | Cobrado: {money(row.amountCollected)} | Pendiente: {money(row.pending)}</Text>
                  </View>
                </View>
              ))}
              {salesRows.length === 0 ? <Text style={styles.s}>Sin ventas para este filtro.</Text> : null}
            </View>
          </>
        )}

        {!loading && tab === "reportes" && (
          <>
            <View style={styles.card}>
              <Text style={styles.t}>Filtros de reportes</Text>
              <TextInput style={styles.i} placeholder="Desde (YYYY-MM-DD)" value={reportFilters.from} onChangeText={(t) => setReportFilters((p) => ({ ...p, from: t }))} />
              <TextInput style={styles.i} placeholder="Hasta (YYYY-MM-DD)" value={reportFilters.to} onChangeText={(t) => setReportFilters((p) => ({ ...p, to: t }))} />

              <View style={styles.selectorShell}>
                <TextInput
                  style={styles.selectorInput}
                  placeholder="Filtrar por cliente"
                  placeholderTextColor="#9aa0ad"
                  value={reportClientQuery}
                  onChangeText={(t) => {
                    setReportClientQuery(t);
                    setReportFilters((p) => ({ ...p, clientId: "" }));
                  }}
                />
                <Pressable
                  style={styles.selectorBtn}
                  onPress={() => {
                    setReportClientQuery("");
                    setReportFilters((p) => ({ ...p, clientId: "" }));
                    setShowReportClientSuggestions(false);
                  }}
                >
                  <Text style={styles.selectorBtnTxt}>X</Text>
                </Pressable>
                <Pressable style={styles.selectorBtn} onPress={() => setShowReportClientSuggestions((p) => !p)}>
                  <Text style={styles.selectorBtnTxt}>{showReportClientSuggestions ? "^" : "v"}</Text>
                </Pressable>
              </View>
              {showReportClientSuggestions && (
                <View style={styles.dropdown}>
                  {filteredReportClientOptions.slice(0, 12).map((client) => (
                    <Pressable key={client.id} style={styles.dropdownItem} onPress={() => selectReportClient(client)}>
                      <Text style={styles.dropdownTitle}>{client.name}</Text>
                      <Text style={styles.dropdownSub}>{client.internalId || client.id} | {client.buyer || "-"}</Text>
                    </Pressable>
                  ))}
                  {filteredReportClientOptions.length === 0 ? <Text style={styles.s}>Sin clientes con ese filtro.</Text> : null}
                </View>
              )}

              <View style={styles.tabs}>
                <Pressable style={[styles.tab, reportFilters.saleType === "all" && styles.tabA]} onPress={() => setReportFilters((p) => ({ ...p, saleType: "all" }))}><Text style={[styles.tabT, reportFilters.saleType === "all" && styles.tabTA]}>Todos</Text></Pressable>
                <Pressable style={[styles.tab, reportFilters.saleType === "consignado" && styles.tabA]} onPress={() => setReportFilters((p) => ({ ...p, saleType: "consignado" }))}><Text style={[styles.tabT, reportFilters.saleType === "consignado" && styles.tabTA]}>Consignado</Text></Pressable>
                <Pressable style={[styles.tab, reportFilters.saleType === "a_vista" && styles.tabA]} onPress={() => setReportFilters((p) => ({ ...p, saleType: "a_vista" }))}><Text style={[styles.tabT, reportFilters.saleType === "a_vista" && styles.tabTA]}>A vista</Text></Pressable>
                <Pressable style={[styles.tab, reportFilters.saleType === "boleto" && styles.tabA]} onPress={() => setReportFilters((p) => ({ ...p, saleType: "boleto" }))}><Text style={[styles.tabT, reportFilters.saleType === "boleto" && styles.tabTA]}>Boleto</Text></Pressable>
                <Pressable style={[styles.tab, reportFilters.saleType === "degustacion" && styles.tabA]} onPress={() => setReportFilters((p) => ({ ...p, saleType: "degustacion" }))}><Text style={[styles.tabT, reportFilters.saleType === "degustacion" && styles.tabTA]}>Degustacion</Text></Pressable>
              </View>

              <View style={styles.quick}>
                <Pressable style={styles.copy} onPress={() => { setReportFilters({ from: "", to: "", clientId: "", saleType: "all" }); setReportClientQuery(""); setShowReportClientSuggestions(false); }}><Text style={styles.copyT}>Limpiar filtros</Text></Pressable>
                <Pressable style={styles.copy} onPress={copyReportSummary}><Text style={styles.copyT}>Copiar resumen</Text></Pressable>
                <Pressable style={styles.copy} onPress={exportReportExcel}><Text style={styles.copyT}>Exportar Excel (.xlsx)</Text></Pressable>
                <Pressable style={styles.copy} onPress={createServerBackup} disabled={backupBusy}><Text style={styles.copyT}>{backupBusy ? "Creando backup..." : "Crear backup servidor"}</Text></Pressable>
                <Pressable style={styles.copy} onPress={exportDbJson}><Text style={styles.copyT}>Exportar JSON</Text></Pressable>
              </View>
              {lastBackupFile ? <Text style={styles.s}>Ultimo backup: {lastBackupFile}</Text> : null}
              <Text style={styles.s}>Incluye datos de admin y vendedores (misma base).</Text>
            </View>

            <View style={styles.grid}>
              <View style={[styles.box, { backgroundColor: "#ffe7c8" }]}><Text>Ventas</Text><Text style={styles.big}>{reportSummary.totalSales.toFixed(2)}</Text></View>
              <View style={[styles.box, { backgroundColor: "#dff4ef" }]}><Text>Cobrado</Text><Text style={styles.big}>{reportSummary.totalCollected.toFixed(2)}</Text></View>
              <View style={[styles.box, { backgroundColor: "#ffe5d9" }]}><Text>Pendiente</Text><Text style={styles.big}>{reportSummary.pendingTotal.toFixed(2)}</Text></View>
              <View style={[styles.box, { backgroundColor: "#f9e2e2" }]}><Text>Vencido</Text><Text style={styles.big}>{reportSummary.overdueTotal.toFixed(2)}</Text></View>
            </View>

            <View style={styles.card}>
              <Text style={styles.t}>Degustaciones y conversion</Text>
              <Text style={styles.s}>Degustaciones: {degustationSummary.totalDegustations}</Text>
              <Text style={styles.s}>Prospectos degustados: {degustationSummary.uniqueProspects}</Text>
              <Text style={styles.s}>Prospectos convertidos: {degustationSummary.converted}</Text>
              <Text style={styles.s}>Tasa de conversion: {degustationSummary.conversionRate.toFixed(1)}%</Text>
              {degustationSummary.latest.map((item) => (
                <View key={item.id} style={styles.itemLine}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.dropdownTitle}>{item.prospectName}</Text>
                    <Text style={styles.dropdownSub}>{item.date} | {item.status}</Text>
                    {item.convertedClientName ? <Text style={styles.dropdownSub}>Cliente convertido: {item.convertedClientName}</Text> : null}
                  </View>
                </View>
              ))}
              {degustationSummary.latest.length === 0 ? <Text style={styles.s}>Sin degustaciones registradas.</Text> : null}
            </View>

            <View style={styles.card}>
              <Text style={styles.t}>Top clientes</Text>
              {reportSummary.byClient.slice(0, 10).map((item) => (
                <View key={item.clientId} style={styles.itemLine}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.dropdownTitle}>{item.clientName}</Text>
                    <Text style={styles.dropdownSub}>{item.internalId || "-"} | Ventas: {num(item.sales).toFixed(2)}</Text>
                    <Text style={styles.dropdownSub}>Cobrado: {num(item.collected).toFixed(2)} | Pendiente: {num(item.pending).toFixed(2)}</Text>
                  </View>
                </View>
              ))}
              {reportSummary.byClient.length === 0 ? <Text style={styles.s}>Sin datos para ese filtro.</Text> : null}
            </View>

            <View style={styles.card}>
              <Text style={styles.t}>Top productos</Text>
              {reportSummary.byProduct.slice(0, 10).map((item) => (
                <View key={item.productName} style={styles.itemLine}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.dropdownTitle}>{item.productName}</Text>
                    <Text style={styles.dropdownSub}>Cantidad: {num(item.quantity).toFixed(2)} | Total: {num(item.total).toFixed(2)}</Text>
                  </View>
                </View>
              ))}
              {reportSummary.byProduct.length === 0 ? <Text style={styles.s}>Sin detalle de productos en ese filtro.</Text> : null}
            </View>

            <View style={styles.card}>
              <Text style={styles.t}>Promedio semanal por producto</Text>
              <Text style={styles.s}>Calculado con: entrega anterior - restante registrado en la próxima visita.</Text>
              {reportWeeklyByProduct.map((item) => (
                <View key={item.productName} style={styles.itemLine}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.dropdownTitle}>{item.productName}</Text>
                    <Text style={styles.dropdownSub}>Promedio semanal: {item.weekly.toFixed(2)} unid</Text>
                    <Text style={styles.dropdownSub}>Sugerencia próxima entrega (7d): {item.suggested} unid</Text>
                  </View>
                </View>
              ))}
              {reportWeeklyByProduct.length === 0 ? <Text style={styles.s}>Sin datos suficientes. Registra "Cantidad restante" al cargar visitas.</Text> : null}
            </View>

            <View style={styles.card}>
              <Text style={styles.t}>Ventas por fecha</Text>
              {reportSummary.byDate.slice(0, 20).map((item) => (
                <View key={item.date} style={styles.itemLine}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.dropdownTitle}>{item.date}</Text>
                    <Text style={styles.dropdownSub}>Visitas: {item.visits} | Ventas: {num(item.sales).toFixed(2)}</Text>
                    <Text style={styles.dropdownSub}>Cobrado: {num(item.collected).toFixed(2)} | Pendiente: {num(item.pending).toFixed(2)}</Text>
                  </View>
                </View>
              ))}
              {reportSummary.byDate.length === 0 ? <Text style={styles.s}>Sin ventas registradas en ese filtro.</Text> : null}
            </View>
          </>
        )}

        {!loading && tab === "nuevaVisita" && <View style={styles.card}>
          <Text style={styles.t}>Datos cliente</Text>
          <Pressable style={[styles.i, visitValidation.missingDate && styles.inputError]} onPress={() => setShowVisitDatePicker(true)}>
            <Text style={styles.datePickerText}>{visitForm.date ? `Fecha de visita: ${visitForm.date}` : "Seleccionar fecha de visita (calendario)"}</Text>
          </Pressable>
          {showVisitDatePicker && (
            <DateTimePicker
              value={visitForm.date ? new Date(`${visitForm.date}T00:00:00`) : new Date()}
              mode="date"
              display="default"
              onChange={onChangeVisitDate}
            />
          )}
          <>
            <View style={[styles.selectorShell, visitValidation.missingClient && styles.inputError]}>
              <TextInput
                style={styles.selectorInput}
                placeholder={visitEntryType === "degustacion" ? "Buscar cliente (opcional en degustacion)" : "Buscar cliente"}
                placeholderTextColor="#9aa0ad"
                value={visitClientQuery}
                onChangeText={(t) => {
                  setVisitClientQuery(t);
                  setVisitForm((p) => ({ ...p, clientId: "" }));
                }}
              />
              <Pressable
                style={styles.selectorBtn}
                onPress={() => {
                  setVisitForm((p) => ({ ...p, clientId: "" }));
                  setVisitClientQuery("");
                  setShowClientSuggestions(false);
                }}
              >
                <Text style={styles.selectorBtnTxt}>X</Text>
              </Pressable>
              <Pressable style={styles.selectorBtn} onPress={() => setShowClientSuggestions((p) => !p)}>
                <Text style={styles.selectorBtnTxt}>{showClientSuggestions ? "˄" : "˅"}</Text>
              </Pressable>
            </View>
            {showClientSuggestions && (
              <View style={styles.dropdown}>
                {filteredVisitClientOptions.slice(0, 10).map((client) => (
                  <Pressable key={client.id} style={styles.dropdownItem} onPress={() => selectVisitClient(client)}>
                    <Text style={styles.dropdownTitle}>{client.name}</Text>
                    <Text style={styles.dropdownSub}>{client.internalId || client.id} | {client.buyer || "-"}</Text>
                  </Pressable>
                ))}
                {filteredVisitClientOptions.length === 0 ? <Text style={styles.s}>Sin clientes con ese filtro.</Text> : null}
              </View>
            )}
          </>
          {visitEntryType === "degustacion" && (
            <>
              <Text style={styles.tSection}>Prospecto (si no es cliente)</Text>
              <TextInput style={[styles.i, visitValidation.missingProspect && styles.inputError]} placeholder="Nombre comercio prospecto" value={visitForm.prospectTradeName} onChangeText={(t) => setVisitForm((p) => ({ ...p, prospectTradeName: t }))} />
              <TextInput style={styles.i} placeholder="Responsable prospecto" value={visitForm.prospectBuyerName} onChangeText={(t) => setVisitForm((p) => ({ ...p, prospectBuyerName: t }))} />
              <TextInput style={styles.i} placeholder="Telefono prospecto" value={visitForm.prospectPhone} onChangeText={(t) => setVisitForm((p) => ({ ...p, prospectPhone: t }))} />
            </>
          )}

          <Text style={styles.tSection}>{visitEntryType === "count_only" ? "Conteo de mercancia disponible" : visitEntryType === "degustacion" ? "Degustacion entregada" : "Mercancia despachada"}</Text>
          {visitEntryType === "count_only" ? <Text style={styles.s}>Modo conteo: no descuenta stock, solo registra disponibilidad actual del cliente.</Text> : null}
          {visitEntryType === "degustacion" ? <Text style={styles.s}>Degustacion: descuenta inventario, no genera deuda ni cobro.</Text> : null}
          <View style={styles.selectorShell}>
            <TextInput
              style={styles.selectorInput}
              placeholder={visitEntryType === "count_only" ? "Producto para conteo" : "Producto dejado"}
              placeholderTextColor="#9aa0ad"
              value={visitItemDraft.productQuery}
              onChangeText={(t) => {
                setVisitItemDraft((p) => ({ ...p, productQuery: t, productId: "" }));
                setShowProductSuggestions(true);
              }}
            />
            <Pressable style={styles.selectorBtn} onPress={() => setVisitItemDraft((p) => ({ ...p, productId: "", productQuery: "", unitPrice: "" }))}>
              <Text style={styles.selectorBtnTxt}>X</Text>
            </Pressable>
            <Pressable style={styles.selectorBtn} onPress={() => setShowProductSuggestions((p) => !p)}>
              <Text style={styles.selectorBtnTxt}>{showProductSuggestions ? "˄" : "˅"}</Text>
            </Pressable>
          </View>
          {showProductSuggestions && (
            <View style={styles.dropdown}>
              {filteredVisitProductOptions.slice(0, 10).map((product) => (
                <Pressable key={product.id} style={styles.dropdownItem} onPress={() => selectVisitProduct(product)}>
                  <Text style={styles.dropdownTitle}>{product.name}</Text>
                  <Text style={styles.dropdownSub}>Precio: {num(product.unitPrice).toFixed(2)}</Text>
                </Pressable>
              ))}
              {filteredVisitProductOptions.length === 0 ? <Text style={styles.s}>Sin productos.</Text> : null}
            </View>
          )}
          {visitEntryType === "dispatch" && (
            <>
              <TextInput style={styles.i} placeholder="Valor del producto" value={visitItemDraft.unitPrice} onChangeText={(t) => setVisitItemDraft((p) => ({ ...p, unitPrice: t }))} />
              <TextInput style={styles.i} placeholder="Cantidad del producto" value={visitItemDraft.quantity} onChangeText={(t) => setVisitItemDraft((p) => ({ ...p, quantity: t }))} keyboardType="decimal-pad" />
            </>
          )}
          {visitEntryType === "degustacion" && (
            <TextInput style={styles.i} placeholder="Cantidad para degustacion" value={visitItemDraft.quantity} onChangeText={(t) => setVisitItemDraft((p) => ({ ...p, quantity: t }))} keyboardType="decimal-pad" />
          )}
          <Pressable style={styles.copy} onPress={addVisitItem}><Text style={styles.copyT}>Agregar producto</Text></Pressable>

          {visitItems.map((item) => (
            <View key={item.id} style={styles.itemLine}>
              <View style={{ flex: 1 }}>
                <Text style={styles.dropdownTitle}>{item.productName}</Text>
                <Text style={styles.dropdownSub}>{visitEntryType === "count_only" ? `Disponible: ${num(item.remaining).toFixed(2)} unid` : visitEntryType === "degustacion" ? `Degustacion: ${num(item.quantity).toFixed(2)} unid` : `Cant: ${item.quantity} | Valor: ${num(item.unitPrice).toFixed(2)} | Total: ${num(item.total).toFixed(2)}`}</Text>
              </View>
              <Pressable style={styles.selectorBtn} onPress={() => removeVisitItem(item.id)}><Text style={styles.selectorBtnTxt}>X</Text></Pressable>
            </View>
          ))}
          {visitValidation.missingItems ? <Text style={styles.warnHint}>{visitEntryType === "count_only" ? "Agrega al menos 1 producto para conteo." : "Agrega al menos 1 producto despachado."}</Text> : null}
          {visitEntryType === "dispatch" && (
            <>
              <Text style={styles.s}>Total productos: {visitTotals.totalQuantity}</Text>
              <Text style={styles.s}>Total despacho: {visitTotals.totalValue.toFixed(2)}</Text>
            </>
          )}
          {visitEntryType === "degustacion" && <Text style={styles.s}>Total degustado: {visitTotals.totalQuantity.toFixed(2)} unid</Text>}

          {visitEntryType !== "degustacion" ? (
            <>
          <Text style={styles.tSection}>Tipo de venta</Text>
          <View style={styles.tabs}>
            {visitEntryType !== "count_only" ? (
              <Pressable style={[styles.tab, visitForm.saleType === "consignado" && styles.tabA]} onPress={() => setVisitForm((p) => ({ ...p, saleType: "consignado", collectionMethod: "" }))}><Text style={[styles.tabT, visitForm.saleType === "consignado" && styles.tabTA]}>Consignado</Text></Pressable>
            ) : null}
            <Pressable style={[styles.tab, visitForm.saleType === "a_vista" && styles.tabA]} onPress={() => setVisitForm((p) => ({ ...p, saleType: "a_vista", collectionMethod: p.collectionMethod && p.collectionMethod !== "boleto" ? p.collectionMethod : "efectivo" }))}><Text style={[styles.tabT, visitForm.saleType === "a_vista" && styles.tabTA]}>A vista</Text></Pressable>
            <Pressable style={[styles.tab, visitForm.saleType === "boleto" && styles.tabA]} onPress={() => setVisitForm((p) => ({ ...p, saleType: "boleto", collectionMethod: "boleto" }))}><Text style={[styles.tabT, visitForm.saleType === "boleto" && styles.tabTA]}>Boleto</Text></Pressable>
          </View>
          {visitForm.saleType === "boleto" && (
            <View style={styles.tabs}>
              <Pressable style={[styles.tab, visitForm.boletoDays === 7 && styles.tabA]} onPress={() => setVisitForm((p) => ({ ...p, boletoDays: 7 }))}><Text style={[styles.tabT, visitForm.boletoDays === 7 && styles.tabTA]}>7 dias</Text></Pressable>
              <Pressable style={[styles.tab, visitForm.boletoDays === 14 && styles.tabA]} onPress={() => setVisitForm((p) => ({ ...p, boletoDays: 14 }))}><Text style={[styles.tabT, visitForm.boletoDays === 14 && styles.tabTA]}>14 dias</Text></Pressable>
            </View>
          )}

          <Text style={styles.tSection}>Valores recaudados</Text>
          <Text style={styles.s}>Deuda pendiente cliente: {num(currentVisitClient?.debt).toFixed(2)}</Text>
          <TextInput style={[styles.i, visitValidation.missingAmount && styles.inputError]} placeholder="Cantidad recibida (obligatorio, 0 si no cobraste)" value={visitForm.amountCollected} onChangeText={(t) => setVisitForm((p) => ({ ...p, amountCollected: t }))} keyboardType="decimal-pad" />
          <View style={styles.tabs}>
            <Pressable style={[styles.tab, visitForm.collectionMethod === "efectivo" && styles.tabA]} onPress={() => setVisitForm((p) => ({ ...p, collectionMethod: "efectivo" }))}><Text style={[styles.tabT, visitForm.collectionMethod === "efectivo" && styles.tabTA]}>Efectivo</Text></Pressable>
            <Pressable style={[styles.tab, visitForm.collectionMethod === "pix" && styles.tabA]} onPress={() => setVisitForm((p) => ({ ...p, collectionMethod: "pix" }))}><Text style={[styles.tabT, visitForm.collectionMethod === "pix" && styles.tabTA]}>PIX</Text></Pressable>
            <Pressable style={[styles.tab, visitForm.collectionMethod === "boleto" && styles.tabA]} onPress={() => setVisitForm((p) => ({ ...p, collectionMethod: "boleto" }))}><Text style={[styles.tabT, visitForm.collectionMethod === "boleto" && styles.tabTA]}>Boleto</Text></Pressable>
            <Pressable style={[styles.tab, visitForm.collectionMethod === "transferencia" && styles.tabA]} onPress={() => setVisitForm((p) => ({ ...p, collectionMethod: "transferencia" }))}><Text style={[styles.tabT, visitForm.collectionMethod === "transferencia" && styles.tabTA]}>Transferencia</Text></Pressable>
          </View>

          <Text style={styles.tSection}>Sugerencia</Text>
          <Text style={styles.s}>Registra restante actual por producto para sugerir la próxima entrega.</Text>
          {visitItems.map((item) => (
            <View key={`remaining_${item.id}`} style={styles.itemLine}>
              <View style={{ flex: 1 }}>
                <Text style={styles.dropdownTitle}>{item.productName}</Text>
                <Text style={styles.dropdownSub}>Despachado hoy: {num(item.quantity).toFixed(2)} unid</Text>
              </View>
              <TextInput
                style={[styles.remainingInput, visitValidation.missingRemainingIds.has(item.id) && styles.remainingInputError]}
                placeholder="Restante"
                value={item.remaining === null ? "" : String(item.remaining)}
                onChangeText={(t) => updateVisitItemRemaining(item.id, t)}
                keyboardType="decimal-pad"
              />
            </View>
          ))}
          {productSuggestionDetails.map((item) => (
            <Text key={`suggest_${item.productName}`} style={styles.s}>
              {item.productName}: promedio {item.avgDelivered.toFixed(2)} unid, restante {item.remaining.toFixed(2)} unid, sugerido {item.suggested} unid
            </Text>
          ))}
          {visitItems.length === 0 ? <Text style={styles.s}>Agrega productos para calcular sugerencias.</Text> : null}
            </>
          ) : (
            <>
              <Text style={styles.tSection}>Tipo de visita</Text>
              <Text style={styles.s}>Degustacion (sin datos de cobro y sin sugerencia).</Text>
            </>
          )}

          <Text style={styles.tSection}>Proxima visita</Text>
          <Text style={styles.s}>Sugerida: {sales?.next ? sales.next : "Sin historico"}</Text>
          <Pressable style={styles.i} onPress={() => setShowNextVisitPicker(true)}>
            <Text style={styles.datePickerText}>{visitForm.nextVisitDate ? `Proxima visita: ${visitForm.nextVisitDate}` : "Seleccionar proxima visita (calendario)"}</Text>
          </Pressable>
          {showNextVisitPicker && (
            <DateTimePicker
              value={visitForm.nextVisitDate ? new Date(`${visitForm.nextVisitDate}T00:00:00`) : new Date()}
              mode="date"
              display="default"
              onChange={onChangeNextVisitDate}
            />
          )}
          <Text style={styles.tSection}>Notas</Text>
          <TextInput style={[styles.i, { minHeight: 80 }]} multiline placeholder="Notas de visita" value={visitForm.notes} onChangeText={(t) => setVisitForm((p) => ({ ...p, notes: t }))} />
          <Text style={styles.s}>Salida estimada (unidades): {soldPreview}</Text>
          {!canSaveVisit ? <Text style={styles.warnHint}>Completa los datos obligatorios para habilitar Guardar.</Text> : null}
          <Pressable style={[styles.btn, !canSaveVisit && styles.btnDisabled]} disabled={!canSaveVisit} onPress={addVisit}><Text style={styles.btnT}>Guardar visita</Text></Pressable>
        </View>}
          </ScrollView>
        </KeyboardAvoidingView>

      {!loading && tab === "clientes" && !selectedClientId && <Pressable style={styles.fab} onPress={openClientFormModal}><Text style={styles.fabT}>+</Text></Pressable>}
      {!loading && tab === "clientes" && !!selectedClientId && <>
        {showActions && <View style={styles.menu}><Pressable style={styles.menuI} onPress={openRegisterVisit}><Text style={styles.menuT}>Registrar visita</Text></Pressable><Pressable style={styles.menuI} onPress={() => { setShowActions(false); setShowSchedule((p) => !p); }}><Text style={styles.menuT}>Agendar visita</Text></Pressable></View>}
        <Pressable style={styles.fab} onPress={() => setShowActions((p) => !p)}><Text style={styles.fabT}>{showActions ? "x" : "+"}</Text></Pressable>
      </>}

      {!loading && tab === "visitas" && !selectedVisitId && <>
        {showVisitsActions && <View style={styles.menu}><Pressable style={styles.menuI} onPress={openRegisterVisitFromVisits}><Text style={styles.menuT}>Visita con despacho</Text></Pressable><Pressable style={styles.menuI} onPress={openCountOnlyVisitFromVisits}><Text style={styles.menuT}>Visita solo conteo</Text></Pressable><Pressable style={styles.menuI} onPress={openDegustationVisitFromVisits}><Text style={styles.menuT}>Registrar degustacion</Text></Pressable><Pressable style={styles.menuI} onPress={() => { setShowVisitsActions(false); setShowVisitScheduleClientSuggestions(false); setShowVisitScheduleForm((p) => !p); }}><Text style={styles.menuT}>Agendar visita</Text></Pressable></View>}
        <Pressable style={styles.fab} onPress={() => setShowVisitsActions((p) => !p)}><Text style={styles.fabT}>{showVisitsActions ? "x" : "+"}</Text></Pressable>
      </>}

      {!loading && tab === "productos" && (
        <Pressable style={styles.fab} onPress={() => setShowProductForm((p) => !p)}>
          <Text style={styles.fabT}>{showProductForm ? "x" : "+"}</Text>
        </Pressable>
      )}

      <Modal transparent visible={showClientForm} animationType="fade" onRequestClose={closeClientFormModal}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <ScrollView contentContainerStyle={{ paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
              <Text style={styles.t}>Nuevo cliente</Text>
              <Text style={styles.s}>ID interno: automatico.</Text>
              <View style={styles.tabs}><Pressable style={[styles.tab, clientForm.managedByType === "owner" && styles.tabA]} onPress={() => updateClientForm({ managedByType: "owner", managedBySellerId: "" })}><Text style={[styles.tabT, clientForm.managedByType === "owner" && styles.tabTA]}>Yo</Text></Pressable><Pressable style={[styles.tab, clientForm.managedByType === "seller" && styles.tabA]} onPress={() => updateClientForm({ managedByType: "seller" })}><Text style={[styles.tabT, clientForm.managedByType === "seller" && styles.tabTA]}>Vendedor</Text></Pressable></View>
              {clientForm.managedByType === "seller" && <View style={styles.tabs}>{sellers.map((s) => <Pressable key={s.id} style={[styles.tab, clientForm.managedBySellerId === s.id && styles.tabA]} onPress={() => updateClientForm({ managedBySellerId: s.id })}><Text style={[styles.tabT, clientForm.managedBySellerId === s.id && styles.tabTA]}>{s.name}</Text></Pressable>)}</View>}
              <TextInput style={styles.i} placeholder="Nombre comercio" value={clientForm.tradeName} onChangeText={(t) => updateClientForm({ tradeName: t })} />
              <TextInput style={styles.i} placeholder="Responsable compras" value={clientForm.buyerName} onChangeText={(t) => updateClientForm({ buyerName: t })} />
              <TextInput style={styles.i} placeholder="CPF" value={clientForm.cpf} onChangeText={(t) => updateClientForm({ cpf: t })} keyboardType="numeric" />
              <TextInput style={styles.i} placeholder="CNPJ" value={clientForm.cnpj} onChangeText={(t) => updateClientForm({ cnpj: t })} keyboardType="numeric" />
              <Pressable style={styles.copy} onPress={lookupCnpj}><Text style={styles.copyT}>{loadingCnpj ? "Buscando..." : "Buscar CNPJ"}</Text></Pressable>
              <TextInput style={styles.i} placeholder="CEP" value={clientForm.cep} onChangeText={(t) => updateClientForm({ cep: t })} keyboardType="numeric" />
              <Pressable style={styles.copy} onPress={lookupCep}><Text style={styles.copyT}>{loadingCep ? "Buscando..." : "Buscar CEP"}</Text></Pressable>
              <TextInput style={styles.i} placeholder="Calle" value={clientForm.addressStreet} onChangeText={(t) => updateClientForm({ addressStreet: t })} />
              <TextInput style={styles.i} placeholder="Numero predio" value={clientForm.addressNumber} onChangeText={(t) => updateClientForm({ addressNumber: t })} />
              <TextInput style={styles.i} placeholder="Barrio" value={clientForm.addressNeighborhood} onChangeText={(t) => updateClientForm({ addressNeighborhood: t })} />
              <TextInput style={styles.i} placeholder="Ciudad" value={clientForm.addressCity} onChangeText={(t) => updateClientForm({ addressCity: t })} />
              <TextInput style={styles.i} placeholder="Estado" value={clientForm.addressState} onChangeText={(t) => updateClientForm({ addressState: t })} />
              <TextInput style={styles.i} placeholder="Tipo comercio" value={clientForm.type} onChangeText={(t) => updateClientForm({ type: t })} />
              <TextInput style={styles.i} placeholder="Telefono" value={clientForm.phone} onChangeText={(t) => updateClientForm({ phone: t })} />
              <TextInput style={styles.i} placeholder="Correo" value={clientForm.email} onChangeText={(t) => updateClientForm({ email: t })} />
              <TextInput style={styles.i} placeholder="IE" value={clientForm.ie} onChangeText={(t) => updateClientForm({ ie: t })} />
              <TextInput style={[styles.i, { minHeight: 80 }]} multiline placeholder="Observaciones" value={clientForm.observations} onChangeText={(t) => updateClientForm({ observations: t })} />
              <View style={styles.modalActions}>
                <Pressable style={styles.copy} onPress={closeClientFormModal}><Text style={styles.copyT}>Cancelar</Text></Pressable>
                <Pressable style={styles.btnMini} onPress={addClient}><Text style={styles.btnT}>Guardar</Text></Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal transparent visible={showSchedule} animationType="fade" onRequestClose={() => setShowSchedule(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.t}>Agendar visita</Text>
            <Pressable style={styles.i} onPress={() => setShowScheduleDatePicker(true)}>
              <Text style={styles.datePickerText}>{scheduleForm.date ? `Fecha: ${scheduleForm.date}` : "Seleccionar fecha (calendario)"}</Text>
            </Pressable>
            {showScheduleDatePicker && (
              <DateTimePicker
                value={scheduleForm.date ? new Date(`${scheduleForm.date}T00:00:00`) : new Date()}
                mode="date"
                display="default"
                onChange={onChangeScheduleDate}
              />
            )}
            <TextInput style={[styles.i, { minHeight: 80 }]} multiline placeholder="Notas" value={scheduleForm.notes} onChangeText={(t) => setScheduleForm((p) => ({ ...p, notes: t }))} />
            <View style={styles.modalActions}>
              <Pressable style={styles.copy} onPress={() => setShowSchedule(false)}><Text style={styles.copyT}>Cancelar</Text></Pressable>
              <Pressable style={styles.btnMini} onPress={scheduleVisit}><Text style={styles.btnT}>Guardar</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal transparent visible={showVisitScheduleForm} animationType="fade" onRequestClose={() => setShowVisitScheduleForm(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.t}>Agendar nueva visita</Text>
            <View style={styles.selectorShell}>
              <TextInput
                style={styles.selectorInput}
                placeholder="Buscar cliente"
                placeholderTextColor="#9aa0ad"
                value={visitScheduleClientQuery}
                onChangeText={(t) => {
                  setVisitScheduleClientQuery(t);
                  setVisitScheduleForm((p) => ({ ...p, clientId: "" }));
                }}
              />
              <Pressable
                style={styles.selectorBtn}
                onPress={() => {
                  setVisitScheduleForm((p) => ({ ...p, clientId: "" }));
                  setVisitScheduleClientQuery("");
                  setShowVisitScheduleClientSuggestions(false);
                }}
              >
                <Text style={styles.selectorBtnTxt}>X</Text>
              </Pressable>
              <Pressable style={styles.selectorBtn} onPress={() => setShowVisitScheduleClientSuggestions((p) => !p)}>
                <Text style={styles.selectorBtnTxt}>{showVisitScheduleClientSuggestions ? "˄" : "˅"}</Text>
              </Pressable>
            </View>
            {showVisitScheduleClientSuggestions && (
              <View style={styles.dropdown}>
                {filteredVisitScheduleClientOptions.slice(0, 10).map((client) => (
                  <Pressable key={client.id} style={styles.dropdownItem} onPress={() => selectVisitScheduleClient(client)}>
                    <Text style={styles.dropdownTitle}>{client.name}</Text>
                    <Text style={styles.dropdownSub}>{client.internalId || client.id} | {client.buyer || "-"}</Text>
                  </Pressable>
                ))}
                {filteredVisitScheduleClientOptions.length === 0 ? <Text style={styles.s}>Sin clientes con ese filtro.</Text> : null}
              </View>
            )}
            <Pressable style={styles.i} onPress={() => setShowVisitScheduleDatePicker(true)}>
              <Text style={styles.datePickerText}>{visitScheduleForm.date ? `Fecha: ${visitScheduleForm.date}` : "Seleccionar fecha (calendario)"}</Text>
            </Pressable>
            {showVisitScheduleDatePicker && (
              <DateTimePicker
                value={visitScheduleForm.date ? new Date(`${visitScheduleForm.date}T00:00:00`) : new Date()}
                mode="date"
                display="default"
                onChange={onChangeVisitScheduleDate}
              />
            )}
            <TextInput style={[styles.i, { minHeight: 80 }]} multiline placeholder="Notas" value={visitScheduleForm.notes} onChangeText={(t) => setVisitScheduleForm((p) => ({ ...p, notes: t }))} />
            <View style={styles.modalActions}>
              <Pressable style={styles.copy} onPress={() => { setShowVisitScheduleForm(false); setShowVisitScheduleClientSuggestions(false); }}><Text style={styles.copyT}>Cancelar</Text></Pressable>
              <Pressable style={styles.btnMini} onPress={scheduleVisitFromVisits}><Text style={styles.btnT}>Guardar</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#fff8ef" }, wrap: { padding: 14, paddingBottom: 110 },
  heroLogoWrap: { alignItems: "center", marginBottom: 8 },
  heroLogo: { width: 84, height: 84, opacity: 0.95 },
  card: { backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: "#f0dfca", padding: 12, marginTop: 10 },
  k: { color: "#7a6a58", fontSize: 12, textTransform: "uppercase", fontWeight: "700" }, h: { fontSize: 28, fontWeight: "800", color: "#2a221a" }, h2: { fontSize: 22, fontWeight: "800", color: "#2f251d", marginTop: 8 },
  t: { fontSize: 16, fontWeight: "800", color: "#2f251d" }, tSection: { marginTop: 12, fontSize: 14, fontWeight: "800", color: "#3f2f1e" }, s: { color: "#7d7266", marginTop: 3 }, debt: { color: "#b64e13", marginTop: 4, fontWeight: "700" },
  tabs: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }, tab: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 20, backgroundColor: "#f6efe6" }, tabA: { backgroundColor: "#d96d20" }, tabT: { color: "#6c5b48", fontWeight: "700", fontSize: 12 }, tabTA: { color: "#fff" },
  err: { marginTop: 10, color: "#b20000", backgroundColor: "#ffe9e9", padding: 10, borderRadius: 10 }, ok: { marginTop: 10, color: "#0f5132", backgroundColor: "#d1e7dd", padding: 10, borderRadius: 10 },
  grid: { marginTop: 10, gap: 8 }, box: { borderRadius: 14, padding: 12 }, big: { fontSize: 24, fontWeight: "800", color: "#2f251d" },
  panelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  panelExpand: { color: "#7d5e37", fontWeight: "700", fontSize: 12 },
  panelDetailBox: { marginTop: 10, borderTopWidth: 1, borderTopColor: "#ecd5b4", paddingTop: 8, gap: 6 },
  panelDetailTitle: { color: "#5a432b", fontWeight: "800", fontSize: 12, textTransform: "uppercase" },
  panelDetailRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  panelDetailName: { flex: 1, color: "#3f2f1e", fontWeight: "700" },
  panelDetailValue: { color: "#5a432b", fontWeight: "700" },
  i: { borderWidth: 1, borderColor: "#dfcfbb", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, marginTop: 8, backgroundColor: "#fffdf9", color: "#2f251d" },
  datePickerText: { color: "#2f251d", fontWeight: "600" },
  selectorShell: { marginTop: 8, minHeight: 42, borderRadius: 10, backgroundColor: "#fffdf9", borderWidth: 1, borderColor: "#dfcfbb", flexDirection: "row", alignItems: "center", paddingLeft: 10, paddingRight: 6 },
  selectorInput: { flex: 1, color: "#2f251d", fontSize: 14, fontWeight: "500", paddingVertical: 8, paddingRight: 6 },
  selectorBtn: { width: 30, height: 30, borderRadius: 7, marginLeft: 6, backgroundColor: "#f1e3d2", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#dfcfbb" },
  selectorBtnTxt: { color: "#5f4a32", fontWeight: "800", fontSize: 11 },
  dropdown: { marginTop: 8, borderWidth: 1, borderColor: "#dfcfbb", borderRadius: 10, backgroundColor: "#fffdf9", padding: 8, gap: 6 },
  dropdownItem: { borderWidth: 1, borderColor: "#f0dfca", borderRadius: 10, paddingVertical: 8, paddingHorizontal: 8, backgroundColor: "#fff" },
  dropdownItemSelected: { backgroundColor: "#ffe7c8", borderColor: "#d96d20" },
  dropdownTitle: { color: "#2f251d", fontWeight: "700" },
  dropdownSub: { color: "#7d7266", marginTop: 2, fontSize: 12 },
  itemLine: { marginTop: 8, borderWidth: 1, borderColor: "#e5d8c5", borderRadius: 10, padding: 8, flexDirection: "row", gap: 8, alignItems: "center", backgroundColor: "#fffdf9" },
  invRowActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  invQtyInput: { width: 88, borderWidth: 1, borderColor: "#dfcfbb", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 8, backgroundColor: "#fff", color: "#2f251d", fontWeight: "700", textAlign: "center" },
  remainingInput: { width: 96, borderWidth: 1, borderColor: "#dfcfbb", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 8, backgroundColor: "#fff", color: "#2f251d", fontWeight: "700", textAlign: "center" },
  inputError: { borderColor: "#c13a2a", borderWidth: 2 },
  remainingInputError: { borderColor: "#c13a2a", borderWidth: 2, backgroundColor: "#fff5f3" },
  btn: { marginTop: 12, backgroundColor: "#d96d20", paddingVertical: 12, borderRadius: 10, alignItems: "center" }, btnT: { color: "#fff", fontWeight: "800" },
  btnDisabled: { backgroundColor: "#d6b294" }, warnHint: { marginTop: 8, color: "#8a5a2d", fontWeight: "600" },
  row: { flexDirection: "row", gap: 10, alignItems: "center", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: "#f4e7d5" }, small: { color: "#7d7266", fontSize: 12 }, bold: { color: "#2f251d", fontWeight: "700" },
  rowWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  copy: { marginTop: 8, backgroundColor: "#f1e3d2", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, alignItems: "center" }, copyT: { color: "#704f2b", fontWeight: "700", fontSize: 12 },
  copyDanger: { backgroundColor: "#ffe3e0", borderWidth: 1, borderColor: "#f1b2ab" },
  copyDangerText: { color: "#ad2f24" },
  quick: { flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" }, quickBtn: { backgroundColor: "#f1e3d2", paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10 }, quickTxt: { color: "#704f2b", fontWeight: "700", fontSize: 12 },
  lock: { marginTop: 8, backgroundColor: "#e8f0fe", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, borderWidth: 1, borderColor: "#c5d8fb" }, lockT: { color: "#2e5aac", fontWeight: "700", fontSize: 12 },
  fab: { position: "absolute", right: 22, bottom: 24, width: 58, height: 58, borderRadius: 29, backgroundColor: "#d96d20", alignItems: "center", justifyContent: "center", elevation: 4 }, fabT: { color: "#fff", fontSize: 30, lineHeight: 32, fontWeight: "700" },
  menu: { position: "absolute", right: 22, bottom: 90, backgroundColor: "#fff", borderWidth: 1, borderColor: "#f0dfca", borderRadius: 12, overflow: "hidden" }, menuI: { paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: "#f3e7d8" }, menuT: { color: "#5d4730", fontWeight: "700" }
  , modalBackdrop: { flex: 1, backgroundColor: "rgba(24,18,13,0.45)", justifyContent: "center", padding: 16 },
  modalCard: { backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: "#f0dfca", padding: 12, maxHeight: "85%" },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 10 },
  btnMini: { backgroundColor: "#d96d20", borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" }
});
