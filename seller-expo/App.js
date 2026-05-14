import React, { useMemo, useState } from "react";
import { View, Text, ScrollView, TextInput, Pressable, StyleSheet, Alert, RefreshControl, Image, Modal, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import DateTimePicker from "@react-native-community/datetimepicker";

const API_BASE = (process.env.EXPO_PUBLIC_API_URL || "http://localhost:4000/api").replace(/\/$/, "");
const today = () => new Date().toISOString().slice(0, 10);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const digits = (v) => String(v || "").replace(/\D/g, "");
const availabilitySourceLabel = (source) => (String(source || "").toLowerCase() === "conteo" ? "conteo" : "estimado");
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

async function parseResponse(r) {
  const raw = await r.text();
  let j;
  try {
    j = JSON.parse(raw);
  } catch {
    j = { error: raw?.slice?.(0, 180) || "Respuesta invalida" };
  }
  if (!r.ok) throw new Error(j.error || "Error");
  return j;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <MainApp />
    </SafeAreaProvider>
  );
}

function MainApp() {
  const insets = useSafeAreaInsets();
  const [token, setToken] = useState("");
  const [tab, setTab] = useState("resumen");
  const [loading, setLoading] = useState(false);
  const [savingClient, setSavingClient] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const [loginForm, setLoginForm] = useState({ username: "edwin", pin: "1234" });
  const [data, setData] = useState({
    seller: null,
    summary: {},
    clients: [],
    agendaWeek: [],
    visitsHistory: [],
    stock: [],
    products: [],
    clientMovements: [],
    paymentsByMethod: {},
    productGoals: [],
    productGoalProgress: []
  });

  const [productGoalForm, setProductGoalForm] = useState({ productId: "", productName: "", targetQty: "" });
  const [clientFilter, setClientFilter] = useState("");
  const [showClientForm, setShowClientForm] = useState(false);
  const [clientForm, setClientForm] = useState({
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
    observations: ""
  });

  const [visitForm, setVisitForm] = useState({
    date: today(),
    clientId: "",
    prospectTradeName: "",
    prospectBuyerName: "",
    prospectPhone: "",
    amountCollected: "",
    collectionMethod: "efectivo",
    saleType: "consignado",
    boletoDays: 7,
    nextVisitDate: "",
    notes: ""
  });
  const [visitClientQuery, setVisitClientQuery] = useState("");
  const [showVisitClientSuggestions, setShowVisitClientSuggestions] = useState(false);
  const [showVisitFormModal, setShowVisitFormModal] = useState(false);
  const [showVisitTypeMenu, setShowVisitTypeMenu] = useState(false);
  const [visitEntryType, setVisitEntryType] = useState("dispatch");
  const [selectedVisitId, setSelectedVisitId] = useState("");
  const [visitItems, setVisitItems] = useState([]);
  const [itemDraft, setItemDraft] = useState({ productId: "", productName: "", quantity: "", unitPrice: "", remaining: "" });
  const [apptForm, setApptForm] = useState({ clientId: "", date: today(), notes: "" });
  const [apptClientQuery, setApptClientQuery] = useState("");
  const [showApptClientSuggestions, setShowApptClientSuggestions] = useState(false);
  const [showAgendaFormModal, setShowAgendaFormModal] = useState(false);
  const [showApptDatePicker, setShowApptDatePicker] = useState(false);
  const [showVisitDatePicker, setShowVisitDatePicker] = useState(false);
  const [showVisitNextDatePicker, setShowVisitNextDatePicker] = useState(false);
  const [showMovementDatePicker, setShowMovementDatePicker] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [activeMovementClientId, setActiveMovementClientId] = useState("");
  const [savingMovement, setSavingMovement] = useState(false);
  const [clientMovementForm, setClientMovementForm] = useState({
    date: today(),
    type: "ajuste",
    productId: "",
    productName: "",
    quantity: "",
    notes: ""
  });

  function notifyError(message) {
    const msg = String(message || "Error");
    setError(msg);
    if (Platform.OS === "web" && typeof window !== "undefined" && typeof window.alert === "function") {
      window.alert(msg);
      return;
    }
    Alert.alert("Error", msg);
  }

  const productOptions = useMemo(
    () => [...(data.products || [])].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "es", { sensitivity: "base" })),
    [data.products]
  );

  const filteredClients = useMemo(() => {
    const q = clientFilter.trim().toLowerCase();
    if (!q) return data.clients || [];
    return (data.clients || []).filter((c) => {
      const name = String(c.tradeName || c.name || "").toLowerCase();
      const buyer = String(c.buyerName || c.contact || "").toLowerCase();
      const cnpj = String(c.cnpj || "").toLowerCase();
      const cpf = String(c.cpf || "").toLowerCase();
      const cep = String(c.cep || "").toLowerCase();
      return name.includes(q) || buyer.includes(q) || cnpj.includes(q) || cpf.includes(q) || cep.includes(q);
    });
  }, [clientFilter, data.clients]);

  const visitClientOptions = useMemo(
    () =>
      [...(data.clients || [])]
        .sort((a, b) => String(a.tradeName || a.name || "").localeCompare(String(b.tradeName || b.name || ""), "es", { sensitivity: "base" }))
        .map((c) => ({
          id: c.id,
          internalId: c.internalId || "",
          name: c.tradeName || c.name || "Cliente",
          buyer: c.buyerName || c.contact || ""
        })),
    [data.clients]
  );

  const filteredVisitClientOptions = useMemo(() => {
    const q = visitClientQuery.trim().toLowerCase();
    if (!q) return visitClientOptions;
    return visitClientOptions.filter((c) =>
      c.id.toLowerCase().includes(q) ||
      c.internalId.toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q) ||
      c.buyer.toLowerCase().includes(q)
    );
  }, [visitClientOptions, visitClientQuery]);

  const filteredApptClientOptions = useMemo(() => {
    const q = apptClientQuery.trim().toLowerCase();
    if (!q) return visitClientOptions;
    return visitClientOptions.filter((c) =>
      c.id.toLowerCase().includes(q) ||
      c.internalId.toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q) ||
      c.buyer.toLowerCase().includes(q)
    );
  }, [visitClientOptions, apptClientQuery]);

  const selectedVisit = useMemo(
    () => (data.visitsHistory || []).find((v) => v.id === selectedVisitId) || null,
    [data.visitsHistory, selectedVisitId]
  );
  const clientMovementsByClient = useMemo(() => {
    const map = new Map();
    for (const movement of data.clientMovements || []) {
      const key = String(movement.clientId || "");
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(movement);
    }
    for (const [key, list] of map.entries()) {
      list.sort((a, b) => new Date(`${b.date}T00:00:00`) - new Date(`${a.date}T00:00:00`));
      map.set(key, list);
    }
    return map;
  }, [data.clientMovements]);

  async function apiGetAuth(path) {
    const r = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    return parseResponse(r);
  }

  async function apiPostAuth(path, body) {
    const r = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body)
    });
    return parseResponse(r);
  }

  async function apiGet(path) {
    const r = await fetch(`${API_BASE}${path}`);
    return parseResponse(r);
  }

  async function login() {
    try {
      setLoading(true);
      setError("");
      const r = await fetch(`${API_BASE}/seller-auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loginForm)
      });
      const j = await parseResponse(r);
      setToken(j.token || "");
      await loadSellerData(j.token || "");
    } catch (e) {
      setError(e.message || "No fue posible iniciar sesion");
    } finally {
      setLoading(false);
    }
  }

  async function loadSellerData(tokenOverride = "") {
    const t = tokenOverride || token;
    if (!t) return;
    try {
      setLoading(true);
      setError("");
      const r = await fetch(`${API_BASE}/seller-app/data`, { headers: { Authorization: `Bearer ${t}` } });
      const j = await parseResponse(r);
      setData(j);
    } catch (e) {
      setError(e.message || "No fue posible cargar datos");
    } finally {
      setLoading(false);
    }
  }

  async function onRefresh() {
    try {
      setRefreshing(true);
      await loadSellerData();
    } finally {
      setRefreshing(false);
    }
  }

  async function logout() {
    try {
      await fetch(`${API_BASE}/seller-auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    } catch {}
    setToken("");
    setData({ seller: null, summary: {}, clients: [], agendaWeek: [], visitsHistory: [], stock: [], products: [], clientMovements: [], paymentsByMethod: {}, productGoals: [], productGoalProgress: [] });
    setVisitItems([]);
  }

  function goBackInApp() {
    if (showVisitFormModal) return setShowVisitFormModal(false);
    if (showAgendaFormModal) return setShowAgendaFormModal(false);
    if (showVisitTypeMenu) return setShowVisitTypeMenu(false);
    if (selectedVisitId) return setSelectedVisitId("");
    if (activeMovementClientId) return setActiveMovementClientId("");
    if (tab !== "resumen") return setTab("resumen");
  }

  function exitAppNow() {
    Alert.alert("Salir", "¿Deseas cerrar sesión?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Cerrar sesión",
        style: "destructive",
        onPress: logout
      }
    ]);
  }

  function onChangeMovementDate(_event, selectedDate) {
    setShowMovementDatePicker(false);
    if (!selectedDate) return;
    setClientMovementForm((p) => ({ ...p, date: selectedDate.toISOString().slice(0, 10) }));
  }

  async function saveClientMovement(client) {
    if (!client?.id) return;
    if (savingMovement) return;
    if (!String(clientMovementForm.productName || "").trim()) return Alert.alert("Error", "Producto obligatorio");
    if (num(clientMovementForm.quantity) <= 0) return Alert.alert("Error", "Cantidad debe ser mayor a 0");
    try {
      setSavingMovement(true);
      await apiPostAuth(`/seller-app/clients/${client.id}/movements`, {
        date: clientMovementForm.date || today(),
        type: clientMovementForm.type || "ajuste",
        productId: clientMovementForm.productId || "",
        productName: String(clientMovementForm.productName || "").trim(),
        quantity: num(clientMovementForm.quantity),
        notes: String(clientMovementForm.notes || "").trim()
      });
      setClientMovementForm({ date: today(), type: "ajuste", productId: "", productName: "", quantity: "", notes: "" });
      setActiveMovementClientId("");
      await loadSellerData();
      Alert.alert("Listo", "Cambio registrado");
    } catch (e) {
      Alert.alert("Error", e.message || "No se pudo registrar cambio");
    } finally {
      setSavingMovement(false);
    }
  }

  async function saveProductGoal() {
    if (!productGoalForm.productName.trim()) return Alert.alert("Error", "Producto obligatorio");
    if (String(productGoalForm.targetQty).trim() === "") return Alert.alert("Error", "Cantidad objetivo obligatoria");
    try {
      await apiPostAuth("/seller-app/product-goals", {
        productId: productGoalForm.productId,
        productName: productGoalForm.productName.trim(),
        targetQty: num(productGoalForm.targetQty)
      });
      setProductGoalForm({ productId: "", productName: "", targetQty: "" });
      await loadSellerData();
      Alert.alert("Listo", "Meta de producto guardada");
    } catch (e) {
      Alert.alert("Error", e.message || "No se pudo guardar meta");
    }
  }

  function updateClientForm(upd) {
    setClientForm((prev) => {
      const next = { ...prev, ...upd };
      next.location = [next.addressStreet, next.addressNumber, next.addressNeighborhood, next.addressCity, next.addressState]
        .filter(Boolean)
        .join(", ");
      return next;
    });
  }

  async function lookupCep() {
    const cep = digits(clientForm.cep);
    if (cep.length !== 8) return Alert.alert("Error", "CEP invalido (8 digitos)");
    try {
      const d = await apiGet(`/lookup/cep/${cep}`);
      const location = [d.street, d.neighborhood, d.city, d.state].filter(Boolean).join(", ");
      updateClientForm({
        cep,
        addressStreet: d.street || clientForm.addressStreet,
        addressNeighborhood: d.neighborhood || clientForm.addressNeighborhood,
        addressCity: d.city || clientForm.addressCity,
        addressState: d.state || clientForm.addressState,
        location: location || clientForm.location
      });
    } catch (e) {
      Alert.alert("Error", e.message || "No fue posible consultar CEP");
    }
  }

  async function lookupCnpj() {
    const cnpj = digits(clientForm.cnpj);
    if (cnpj.length !== 14) return Alert.alert("Error", "CNPJ invalido (14 digitos)");
    try {
      const d = await apiGet(`/lookup/cnpj/${cnpj}`);
      const location = [d.street, d.number, d.neighborhood, d.city, d.state].filter(Boolean).join(", ");
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
        addressState: d.state || clientForm.addressState,
        location: location || clientForm.location
      });
    } catch (e) {
      Alert.alert("Error", e.message || "No fue posible consultar CNPJ");
    }
  }

  async function createClient() {
    if (savingClient) return;
    if (!clientForm.tradeName.trim()) return Alert.alert("Error", "Nombre comercio obligatorio");
    try {
      setSavingClient(true);
      await apiPostAuth("/seller-app/clients", clientForm);
      setClientForm({ tradeName: "", buyerName: "", cep: "", addressStreet: "", addressNumber: "", addressNeighborhood: "", addressCity: "", addressState: "", location: "", type: "", phone: "", email: "", cpf: "", cnpj: "", ie: "", observations: "" });
      setShowClientForm(false);
      await loadSellerData();
      Alert.alert("Listo", "Cliente creado y asignado");
    } catch (e) {
      Alert.alert("Error", e.message || "No se pudo crear cliente");
    } finally {
      setSavingClient(false);
    }
  }

  function addVisitItem() {
    if (!itemDraft.productName.trim()) return Alert.alert("Error", "Producto obligatorio");
    if (visitEntryType !== "degustacion" && String(itemDraft.remaining).trim() === "") return Alert.alert("Error", "Restante obligatorio");
    if (visitEntryType !== "count_only" && String(itemDraft.quantity).trim() === "") return Alert.alert("Error", "Cantidad obligatoria");
    const quantity = visitEntryType === "count_only" ? 0 : num(itemDraft.quantity);
    const unitPrice = visitEntryType === "dispatch" ? num(itemDraft.unitPrice) : 0;
    const line = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      productId: itemDraft.productId || "",
      productName: itemDraft.productName.trim(),
      quantity,
      unitPrice,
      total: quantity * unitPrice,
      remaining: visitEntryType === "degustacion" ? null : num(itemDraft.remaining)
    };
    setVisitItems((p) => [...p, line]);
    setItemDraft({ productId: "", productName: "", quantity: "", unitPrice: "", remaining: "" });
  }

  async function saveVisit() {
    const isDegustation = visitEntryType === "degustacion";
    if (!isDegustation && !visitForm.clientId) return notifyError("Cliente obligatorio");
    if (isDegustation && !visitForm.clientId && !String(visitForm.prospectTradeName || "").trim()) {
      return notifyError("En degustacion debes seleccionar cliente o indicar comercio prospecto.");
    }
    if (!visitForm.date) return notifyError("Fecha obligatoria");
    if (!isDegustation && String(visitForm.amountCollected).trim() === "") return notifyError("Monto cobrado obligatorio (usa 0)");
    if (visitItems.length === 0) return notifyError(visitEntryType === "count_only" ? "Agrega al menos un producto para conteo" : "Agrega al menos un producto");
    if (visitEntryType === "count_only" && visitForm.saleType === "consignado") return notifyError("En visita solo conteo, usa A vista o Boleto.");
    try {
      const saleType = isDegustation ? "degustacion" : visitForm.saleType;
      await apiPostAuth("/seller-app/visits", {
        ...visitForm,
        visitType: visitEntryType,
        collectionMethod:
          isDegustation
            ? ""
            : visitForm.saleType === "boleto"
            ? "boleto"
            : visitForm.saleType === "consignado"
              ? ""
              : visitForm.collectionMethod || "efectivo",
        amountCollected: isDegustation ? 0 : num(visitForm.amountCollected),
        saleType,
        paymentType: isDegustation ? "degustacion" : visitForm.saleType === "a_vista" ? "contado" : "consignado",
        items: visitItems,
        delivered: visitEntryType === "count_only" ? 0 : visitItems.reduce((acc, i) => acc + num(i.quantity), 0),
        remaining: 0
      });
      setVisitForm({
        date: today(),
        clientId: "",
        prospectTradeName: "",
        prospectBuyerName: "",
        prospectPhone: "",
        amountCollected: "",
        collectionMethod: "efectivo",
        saleType: "consignado",
        boletoDays: 7,
        nextVisitDate: "",
        notes: ""
      });
      setVisitClientQuery("");
      setShowVisitClientSuggestions(false);
      setVisitItems([]);
      setVisitEntryType("dispatch");
      setShowVisitFormModal(false);
      await loadSellerData();
      Alert.alert("Listo", "Visita registrada");
    } catch (e) {
      notifyError(e.message || "No se pudo guardar visita");
    }
  }

  async function saveAppointment() {
    if (!apptForm.clientId || !apptForm.date) return Alert.alert("Error", "Cliente y fecha obligatorios");
    try {
      await apiPostAuth("/seller-app/appointments", apptForm);
      setApptForm({ clientId: "", date: today(), notes: "" });
      setApptClientQuery("");
      setShowApptClientSuggestions(false);
      setShowAgendaFormModal(false);
      await loadSellerData();
      Alert.alert("Listo", "Visita agendada");
    } catch (e) {
      Alert.alert("Error", e.message || "No se pudo agendar");
    }
  }


  function onChangeApptDate(_event, selected) {
    setShowApptDatePicker(false);
    if (!selected) return;
    setApptForm((p) => ({ ...p, date: selected.toISOString().slice(0, 10) }));
  }

  function onChangeVisitDate(_event, selected) {
    setShowVisitDatePicker(false);
    if (!selected) return;
    setVisitForm((p) => ({ ...p, date: selected.toISOString().slice(0, 10) }));
  }

  function onChangeVisitNextDate(_event, selected) {
    setShowVisitNextDatePicker(false);
    if (!selected) return;
    setVisitForm((p) => ({ ...p, nextVisitDate: selected.toISOString().slice(0, 10) }));
  }

  function onChangeSaleType(nextSaleType) {
    setVisitForm((p) => {
      if (visitEntryType === "count_only" && nextSaleType === "consignado") return p;
      if (nextSaleType === "consignado") return { ...p, saleType: nextSaleType, collectionMethod: "" };
      if (nextSaleType === "boleto") return { ...p, saleType: nextSaleType, collectionMethod: "boleto" };
      const nextMethod = p.collectionMethod && p.collectionMethod !== "boleto" ? p.collectionMethod : "efectivo";
      return { ...p, saleType: nextSaleType, collectionMethod: nextMethod };
    });
  }

  function openVisitModalWithType(type) {
    setVisitEntryType(type);
    if (type === "count_only") {
      setVisitForm((p) => ({ ...p, saleType: "a_vista", collectionMethod: "efectivo", boletoDays: 7, prospectTradeName: "", prospectBuyerName: "", prospectPhone: "" }));
    } else if (type === "degustacion") {
      setVisitForm((p) => ({ ...p, saleType: "degustacion", collectionMethod: "", amountCollected: "0", boletoDays: 0, prospectTradeName: "", prospectBuyerName: "", prospectPhone: "" }));
    } else {
      setVisitForm((p) => ({ ...p, saleType: "consignado", collectionMethod: "", boletoDays: 7, prospectTradeName: "", prospectBuyerName: "", prospectPhone: "" }));
    }
    setVisitItems([]);
    setItemDraft({ productId: "", productName: "", quantity: "", unitPrice: "", remaining: "" });
    setShowVisitTypeMenu(false);
    setShowVisitFormModal(true);
  }

  if (!token) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <StatusBar style="dark" />
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "ios" ? 12 : 0}>
          <View style={styles.wrap}>
            <View style={styles.card}>
              <Text style={styles.h}>App Vendedor</Text>
              <Text style={styles.s}>VeDistribuidora</Text>
              <TextInput style={styles.i} placeholderTextColor="#8f816f" placeholder="Usuario" value={loginForm.username} onChangeText={(t) => setLoginForm((p) => ({ ...p, username: t }))} autoCapitalize="none" />
              <View style={styles.pinRow}>
                <TextInput style={[styles.i, styles.pinInput]} placeholderTextColor="#8f816f" placeholder="PIN" value={loginForm.pin} onChangeText={(t) => setLoginForm((p) => ({ ...p, pin: t }))} secureTextEntry={!showPin} keyboardType="numeric" />
                <Pressable style={styles.pinToggle} onPress={() => setShowPin((p) => !p)}><Text style={styles.copyT}>{showPin ? "Ocultar" : "Ver"}</Text></Pressable>
              </View>
              {error ? <Text style={styles.err}>{error}</Text> : null}
              <Pressable style={styles.btn} onPress={login} disabled={loading}><Text style={styles.btnT}>{loading ? "Entrando..." : "Entrar"}</Text></Pressable>
              <Text style={styles.s}>Demo inicial: `edwin` / `1234`</Text>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "ios" ? 12 : 0}>
        <ScrollView
          contentContainerStyle={styles.wrap}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#d96d20" />}
        >
        <View style={styles.topBar}>
          {tab === "resumen" ? (
            <View style={styles.topBtnGhost} />
          ) : (
            <Pressable style={styles.topBtn} onPress={goBackInApp}>
              <Text style={styles.topBtnText}>←</Text>
            </Pressable>
          )}
          <Pressable style={styles.topBtn} onPress={exitAppNow}>
            <Text style={styles.topBtnText}>⎋</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <View style={styles.heroLogoWrap}>
            <Image source={LOGO} style={styles.heroLogo} resizeMode="contain" />
          </View>
          <Text style={styles.h}>{data.seller?.name || "-"}</Text>
          <Text style={styles.s}>Ventas semana: {num(data.summary?.weekSales).toFixed(2)} | Mes: {num(data.summary?.monthSales).toFixed(2)}</Text>
          <Text style={styles.s}>Comision mes: {num(data.summary?.commissionAmount).toFixed(2)} | Deuda cartera: {num(data.summary?.totalDebt).toFixed(2)}</Text>
          <View style={styles.rowBtns} />
        </View>

        <View style={styles.tabs}>{[["resumen", "Metas"], ["clientes", "Clientes"], ["agenda", "Agenda"], ["visitas", "Visitas"], ["stock", "Stock disponible"]].map(([id, t]) => (
          <Pressable key={id} style={[styles.tab, tab === id && styles.tabA]} onPress={() => { setTab(id); if (id !== "visitas") setSelectedVisitId(""); setShowVisitTypeMenu(false); }}><Text style={[styles.tabT, tab === id && styles.tabTA]}>{t}</Text></Pressable>
        ))}</View>

        {tab === "resumen" && (
          <View style={styles.card}>
            <Text style={styles.t}>Meta por producto</Text>
            <TextInput style={styles.i} placeholderTextColor="#8f816f" placeholder="Producto" value={productGoalForm.productName} onChangeText={(t) => setProductGoalForm((p) => ({ ...p, productName: t, productId: "" }))} />
            <View style={styles.rowBtns}>{productOptions.slice(0, 8).map((p) => <Pressable key={p.id} style={styles.quick} onPress={() => setProductGoalForm((d) => ({ ...d, productId: p.id, productName: p.name }))}><Text style={styles.quickT}>{p.name}</Text></Pressable>)}</View>
            <TextInput style={styles.i} placeholderTextColor="#8f816f" placeholder="Cantidad objetivo semanal (unid)" value={productGoalForm.targetQty} onChangeText={(t) => setProductGoalForm((p) => ({ ...p, targetQty: t }))} keyboardType="decimal-pad" />
            <Pressable style={styles.btn} onPress={saveProductGoal}><Text style={styles.btnT}>Guardar meta de producto</Text></Pressable>

            <Text style={styles.t}>Progreso semanal</Text>
            {(data.productGoalProgress || []).map((g) => (
              <View key={g.id} style={styles.item}>
                <Text style={styles.itemT}>{g.productName}</Text>
                <Text style={styles.s}>Meta: {num(g.targetQty).toFixed(2)} unid | Vendido: {num(g.soldQty).toFixed(2)} unid</Text>
                <Text style={styles.s}>Faltante: {num(g.remainingQty).toFixed(2)} unid | Progreso: {num(g.progressPct).toFixed(1)}%</Text>
              </View>
            ))}
            {(data.productGoalProgress || []).length === 0 ? <Text style={styles.s}>Todavia no hay metas por producto.</Text> : null}
          </View>
        )}

        {tab === "clientes" && (
          <>
            <View style={styles.card}>
              <Text style={styles.t}>Mi cartera</Text>
              <TextInput style={styles.i} placeholderTextColor="#8f816f" placeholder="Buscar por nombre, CPF/CNPJ o CEP" value={clientFilter} onChangeText={setClientFilter} />
              {filteredClients.map((c) => {
                const availability = Array.isArray(c.productAvailability) && c.productAvailability.length > 0
                  ? c.productAvailability
                  : computeAvailabilityFromVisits(data.visitsHistory || [], c.id);
                const movementOpen = activeMovementClientId === c.id;
                const movements = clientMovementsByClient.get(String(c.id)) || [];
                return (
                <View key={c.id} style={styles.item}>
                  <Text style={styles.itemT}>{c.tradeName}</Text>
                  <Text style={styles.s}>{c.internalId || c.id} | Deuda: {num(c.debt).toFixed(2)}</Text>
                  <Text style={styles.s}>CPF: {c.cpf || "-"} | CNPJ: {c.cnpj || "-"} | CEP: {c.cep || "-"}</Text>
                  {availability.map((item, idx) => (
                    <Text key={`${c.id}_pa_${idx}`} style={styles.s}>
                      Disponible {item.productName}: {num(item.availableQty).toFixed(2)} unid ({availabilitySourceLabel(item.source)})
                    </Text>
                  ))}
                  <View style={styles.rowBtns}>
                    <Pressable
                      style={styles.copy}
                      onPress={() => {
                        if (movementOpen) {
                          setActiveMovementClientId("");
                          return;
                        }
                        setActiveMovementClientId(c.id);
                        setClientMovementForm({ date: today(), type: "ajuste", productId: "", productName: "", quantity: "", notes: "" });
                      }}
                    >
                      <Text style={styles.copyT}>{movementOpen ? "Cerrar cambio" : "Registrar cambio"}</Text>
                    </Pressable>
                  </View>
                  {movementOpen ? (
                    <View style={[styles.card, { marginTop: 8 }]}>
                      <Text style={styles.t}>Cambio del cliente</Text>
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
                      <View style={styles.tabs}>
                        {[["vencido", "Vencido"], ["danado", "Danado"], ["devolucion", "Devolucion"], ["ajuste", "Ajuste"], ["otro", "Otro"]].map(([id, label]) => (
                          <Pressable key={id} style={[styles.tab, clientMovementForm.type === id && styles.tabA]} onPress={() => setClientMovementForm((p) => ({ ...p, type: id }))}>
                            <Text style={[styles.tabT, clientMovementForm.type === id && styles.tabTA]}>{label}</Text>
                          </Pressable>
                        ))}
                      </View>
                      <TextInput
                        style={styles.i}
                        placeholderTextColor="#8f816f"
                        placeholder="Producto"
                        value={clientMovementForm.productName}
                        onChangeText={(t) => setClientMovementForm((p) => ({ ...p, productName: t, productId: "" }))}
                      />
                      <View style={styles.rowBtns}>
                        {productOptions.slice(0, 6).map((p) => (
                          <Pressable key={`mov_${c.id}_${p.id}`} style={styles.quick} onPress={() => setClientMovementForm((d) => ({ ...d, productId: p.id, productName: p.name }))}>
                            <Text style={styles.quickT}>{p.name}</Text>
                          </Pressable>
                        ))}
                      </View>
                      <TextInput
                        style={styles.i}
                        placeholderTextColor="#8f816f"
                        placeholder="Cantidad (unid)"
                        value={clientMovementForm.quantity}
                        onChangeText={(t) => setClientMovementForm((p) => ({ ...p, quantity: t }))}
                        keyboardType="decimal-pad"
                      />
                      <TextInput
                        style={styles.i}
                        placeholderTextColor="#8f816f"
                        placeholder="Motivo / nota"
                        value={clientMovementForm.notes}
                        onChangeText={(t) => setClientMovementForm((p) => ({ ...p, notes: t }))}
                      />
                      <Pressable style={[styles.btn, savingMovement && styles.btnDisabled]} onPress={() => saveClientMovement(c)} disabled={savingMovement}>
                        <Text style={styles.btnT}>{savingMovement ? "Guardando..." : "Guardar cambio"}</Text>
                      </Pressable>
                      <Text style={styles.t}>Historial de cambios</Text>
                      {movements.slice(0, 8).map((movement) => (
                        <View key={movement.id} style={styles.item}>
                          <Text style={styles.itemT}>{movement.date} | {String(movement.type || "").toUpperCase()}</Text>
                          <Text style={styles.s}>{movement.productName} - {num(movement.quantity).toFixed(2)} unid</Text>
                          {movement.notes ? <Text style={styles.s}>{movement.notes}</Text> : null}
                        </View>
                      ))}
                      {movements.length === 0 ? <Text style={styles.s}>Sin cambios registrados.</Text> : null}
                    </View>
                  ) : null}
                </View>
              );})}
              {filteredClients.length === 0 ? <Text style={styles.s}>Sin clientes con ese filtro.</Text> : null}
            </View>
            {showClientForm && (
              <View style={styles.card}>
                <Text style={styles.t}>Registrar cliente</Text>
                <TextInput style={styles.i} placeholderTextColor="#8f816f" placeholder="Nombre comercio" value={clientForm.tradeName} onChangeText={(t) => updateClientForm({ tradeName: t })} />
                <TextInput style={styles.i} placeholderTextColor="#8f816f" placeholder="Responsable compras" value={clientForm.buyerName} onChangeText={(t) => updateClientForm({ buyerName: t })} />
                <TextInput style={styles.i} placeholderTextColor="#8f816f" placeholder="CPF" value={clientForm.cpf} onChangeText={(t) => updateClientForm({ cpf: t })} keyboardType="numeric" />
                <TextInput style={styles.i} placeholderTextColor="#8f816f" placeholder="CNPJ" value={clientForm.cnpj} onChangeText={(t) => updateClientForm({ cnpj: t })} keyboardType="numeric" />
                <Pressable style={styles.copy} onPress={lookupCnpj}><Text style={styles.copyT}>Buscar CNPJ</Text></Pressable>
                <TextInput style={styles.i} placeholderTextColor="#8f816f" placeholder="CEP" value={clientForm.cep} onChangeText={(t) => updateClientForm({ cep: t })} keyboardType="numeric" />
                <Pressable style={styles.copy} onPress={lookupCep}><Text style={styles.copyT}>Buscar CEP</Text></Pressable>
                <TextInput style={styles.i} placeholderTextColor="#8f816f" placeholder="Calle" value={clientForm.addressStreet} onChangeText={(t) => updateClientForm({ addressStreet: t })} />
                <TextInput style={styles.i} placeholderTextColor="#8f816f" placeholder="Numero predio" value={clientForm.addressNumber} onChangeText={(t) => updateClientForm({ addressNumber: t })} />
                <TextInput style={styles.i} placeholderTextColor="#8f816f" placeholder="Barrio" value={clientForm.addressNeighborhood} onChangeText={(t) => updateClientForm({ addressNeighborhood: t })} />
                <TextInput style={styles.i} placeholderTextColor="#8f816f" placeholder="Ciudad" value={clientForm.addressCity} onChangeText={(t) => updateClientForm({ addressCity: t })} />
                <TextInput style={styles.i} placeholderTextColor="#8f816f" placeholder="Estado" value={clientForm.addressState} onChangeText={(t) => updateClientForm({ addressState: t })} />
                <TextInput style={styles.i} placeholderTextColor="#8f816f" placeholder="Ubicacion" value={clientForm.location} onChangeText={(t) => updateClientForm({ location: t })} />
                <TextInput style={styles.i} placeholderTextColor="#8f816f" placeholder="Tipo comercio" value={clientForm.type} onChangeText={(t) => updateClientForm({ type: t })} />
                <TextInput style={styles.i} placeholderTextColor="#8f816f" placeholder="Telefono" value={clientForm.phone} onChangeText={(t) => updateClientForm({ phone: t })} />
                <TextInput style={styles.i} placeholderTextColor="#8f816f" placeholder="Correo" value={clientForm.email} onChangeText={(t) => updateClientForm({ email: t })} />
                <TextInput style={styles.i} placeholderTextColor="#8f816f" placeholder="IE" value={clientForm.ie} onChangeText={(t) => updateClientForm({ ie: t })} />
                <TextInput style={styles.i} placeholderTextColor="#8f816f" placeholder="Observaciones" value={clientForm.observations} onChangeText={(t) => updateClientForm({ observations: t })} />
                <Pressable style={[styles.btn, savingClient && styles.btnDisabled]} onPress={createClient} disabled={savingClient}><Text style={styles.btnT}>{savingClient ? "Guardando..." : "Guardar cliente"}</Text></Pressable>
              </View>
            )}
          </>
        )}

        {tab === "agenda" && (
          <View style={styles.card}>
            <Text style={styles.t}>Agenda pendiente</Text>
            {(data.agendaWeek || []).map((a) => (
              <View key={a.id} style={styles.item}><Text style={styles.itemT}>{a.date} - {a.clientName}</Text><Text style={styles.s}>{a.clientInternalId || a.clientId} {a.notes ? `| ${a.notes}` : ""}</Text></View>
            ))}
            {(data.agendaWeek || []).length === 0 ? <Text style={styles.s}>Sin visitas agendadas.</Text> : null}
          </View>
        )}

        {tab === "visitas" && !selectedVisit && (
          <View style={styles.card}>
            <Text style={styles.t}>Historico (ultimas visitas)</Text>
            {(data.visitsHistory || []).slice(0, 20).map((v) => (
              <Pressable key={v.id} style={styles.item} onPress={() => setSelectedVisitId(v.id)}>
                <Text style={styles.itemT}>{v.date} - {v.clientName}</Text>
                <Text style={styles.s}>Total {num(v.totalValue || v.soldAmount).toFixed(2)} | Cobrado {num(v.amountCollected).toFixed(2)}</Text>
                <Text style={styles.s}>Tocar para ver detalle</Text>
              </Pressable>
            ))}
            {(data.visitsHistory || []).length === 0 ? <Text style={styles.s}>Sin visitas registradas.</Text> : null}
          </View>
        )}

        {tab === "visitas" && !!selectedVisit && (
          <>
            <View style={styles.card}>
              <Pressable style={styles.copy} onPress={() => setSelectedVisitId("")}>
                <Text style={styles.copyT}>Volver a visitas</Text>
              </Pressable>
              <Text style={styles.t}>Detalle de visita</Text>
              <Text style={styles.s}>Cliente: {selectedVisit.clientName || selectedVisit.prospectTradeName || "Prospecto"}</Text>
              <Text style={styles.s}>Fecha: {selectedVisit.date || "-"}</Text>
              <Text style={styles.s}>Tipo venta: {selectedVisit.saleType || selectedVisit.paymentType || "-"}</Text>
              <Text style={styles.s}>Forma cobro: {selectedVisit.collectionMethod || "-"}</Text>
              {selectedVisit.saleType === "boleto" ? <Text style={styles.s}>Boleto: {selectedVisit.boletoDays || "-"} dias | Vence: {selectedVisit.dueDate || "-"}</Text> : null}
              <Text style={styles.s}>Cobrado: {num(selectedVisit.amountCollected).toFixed(2)}</Text>
              <Text style={styles.s}>Proxima visita: {selectedVisit.nextVisitDate || "-"}</Text>
              <Text style={styles.s}>Notas: {selectedVisit.notes || "-"}</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.t}>Productos de la visita</Text>
              {(Array.isArray(selectedVisit.items) ? selectedVisit.items : []).map((item, idx) => (
                <View key={`${selectedVisit.id}_${idx}`} style={styles.item}>
                  <Text style={styles.itemT}>{item.productName}</Text>
                  <Text style={styles.s}>Cant {num(item.quantity).toFixed(2)} | Valor {num(item.unitPrice).toFixed(2)} | Total {num(item.total).toFixed(2)}</Text>
                  <Text style={styles.s}>Restante: {item.remaining === null || item.remaining === undefined ? "-" : num(item.remaining).toFixed(2)}</Text>
                </View>
              ))}
              {(!Array.isArray(selectedVisit.items) || selectedVisit.items.length === 0) ? <Text style={styles.s}>Sin detalle de productos (visita antigua).</Text> : null}
            </View>
          </>
        )}

        {tab === "stock" && (
          <View style={styles.card}>
            <Text style={styles.t}>Stock disponible</Text>
            {(data.stock || []).map((s) => (
              <View key={s.id} style={styles.item}><Text style={styles.itemT}>{s.productName}</Text><Text style={styles.s}>Stock {num(s.quantity).toFixed(2)} unid | {s.updatedAt ? s.updatedAt.slice(0, 10) : "-"}</Text></View>
            ))}
            {(data.stock || []).length === 0 ? <Text style={styles.s}>Sin stock cargado por admin.</Text> : null}
          </View>
        )}
        </ScrollView>
      </KeyboardAvoidingView>
      {showVisitFormModal && (
        <Modal transparent visible={showVisitFormModal} animationType="fade" onRequestClose={() => setShowVisitFormModal(false)}>
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <ScrollView contentContainerStyle={{ paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
                <Text style={styles.t}>
                  {visitEntryType === "count_only"
                    ? "Registrar visita (solo conteo)"
                    : visitEntryType === "degustacion"
                      ? "Registrar degustacion"
                      : "Registrar visita (con despacho)"}
                </Text>
                {visitEntryType === "count_only" ? <Text style={styles.s}>Modo conteo: no descuenta stock, solo registra mercancia disponible.</Text> : null}
                {visitEntryType === "degustacion" ? <Text style={styles.s}>Degustacion: descuenta stock, no genera deuda ni cobro.</Text> : null}
                {Platform.OS === "web" ? (
                  <TextInput
                    style={styles.i}
                    placeholderTextColor="#8f816f"
                    placeholder="Fecha visita (AAAA-MM-DD)"
                    value={visitForm.date}
                    onChangeText={(t) => setVisitForm((p) => ({ ...p, date: t }))}
                  />
                ) : (
                  <>
                    <Pressable style={styles.i} onPress={() => setShowVisitDatePicker(true)}>
                      <Text style={styles.datePickerText}>{visitForm.date ? `Fecha: ${visitForm.date}` : "Seleccionar fecha (calendario)"}</Text>
                    </Pressable>
                    {showVisitDatePicker && (
                      <DateTimePicker
                        value={visitForm.date ? new Date(`${visitForm.date}T00:00:00`) : new Date()}
                        mode="date"
                        display="default"
                        onChange={onChangeVisitDate}
                      />
                    )}
                  </>
                )}
                <View style={styles.selectorShell}>
                  <TextInput
                    style={styles.selectorInput}
                    placeholderTextColor="#8f816f" placeholder={visitEntryType === "degustacion" ? "Buscar cliente (opcional)" : "Buscar cliente (ID / comercio / responsable)"}
                    value={visitClientQuery}
                    onChangeText={(t) => {
                      setVisitClientQuery(t);
                      setVisitForm((p) => ({ ...p, clientId: "" }));
                      setShowVisitClientSuggestions(true);
                    }}
                  />
                  <Pressable style={styles.selectorBtn} onPress={() => { setVisitClientQuery(""); setVisitForm((p) => ({ ...p, clientId: "" })); setShowVisitClientSuggestions(false); }}>
                    <Text style={styles.selectorBtnTxt}>X</Text>
                  </Pressable>
                  <Pressable style={styles.selectorBtn} onPress={() => setShowVisitClientSuggestions((p) => !p)}>
                    <Text style={styles.selectorBtnTxt}>{showVisitClientSuggestions ? "^" : "?"}</Text>
                  </Pressable>
                </View>
                {showVisitClientSuggestions && (
                  <View style={styles.dropdown}>
                    {filteredVisitClientOptions.slice(0, 10).map((client) => (
                      <Pressable key={client.id} style={styles.dropdownItem} onPress={() => { setVisitForm((p) => ({ ...p, clientId: client.id })); setVisitClientQuery(`${client.name} (${client.internalId || client.id})`); setShowVisitClientSuggestions(false); }}>
                        <Text style={styles.itemT}>{client.name}</Text>
                        <Text style={styles.s}>{client.internalId || client.id} | {client.buyer || "-"}</Text>
                      </Pressable>
                    ))}
                    {filteredVisitClientOptions.length === 0 ? <Text style={styles.s}>Sin clientes con ese filtro.</Text> : null}
                  </View>
                )}
                {visitEntryType === "degustacion" && (
                  <>
                    <TextInput style={styles.i} placeholderTextColor="#8f816f" placeholder="Nombre comercio prospecto (si no seleccionas cliente)" value={visitForm.prospectTradeName} onChangeText={(t) => setVisitForm((p) => ({ ...p, prospectTradeName: t }))} />
                    <TextInput style={styles.i} placeholderTextColor="#8f816f" placeholder="Responsable prospecto (opcional)" value={visitForm.prospectBuyerName} onChangeText={(t) => setVisitForm((p) => ({ ...p, prospectBuyerName: t }))} />
                    <TextInput style={styles.i} placeholderTextColor="#8f816f" placeholder="Telefono prospecto (opcional)" value={visitForm.prospectPhone} onChangeText={(t) => setVisitForm((p) => ({ ...p, prospectPhone: t }))} keyboardType="phone-pad" />
                  </>
                )}

                {visitEntryType !== "degustacion" && (
                  <>
                    <View style={styles.tabs}>
                      {(visitEntryType === "count_only" ? [["a_vista", "A vista"], ["boleto", "Boleto"]] : [["consignado", "Consig."], ["a_vista", "A vista"], ["boleto", "Boleto"]]).map(([id, label]) => (
                        <Pressable key={id} style={[styles.tab, visitForm.saleType === id && styles.tabA]} onPress={() => onChangeSaleType(id)}>
                          <Text style={[styles.tabT, visitForm.saleType === id && styles.tabTA]}>{label}</Text>
                        </Pressable>
                      ))}
                    </View>
                    {visitForm.saleType === "a_vista" && (
                      <View style={styles.tabs}>{[["efectivo", "Efectivo"], ["pix", "PIX"], ["transferencia", "Transfer"]].map(([id, label]) => <Pressable key={id} style={[styles.tab, visitForm.collectionMethod === id && styles.tabA]} onPress={() => setVisitForm((p) => ({ ...p, collectionMethod: id }))}><Text style={[styles.tabT, visitForm.collectionMethod === id && styles.tabTA]}>{label}</Text></Pressable>)}</View>
                    )}
                    {visitForm.saleType === "consignado" && <Text style={styles.s}>Consignado: la forma de cobro se registra cuando se recauda.</Text>}
                    {visitForm.saleType === "boleto" && (
                      <>
                        <Text style={styles.s}>Forma de cobro: boleto</Text>
                        <View style={styles.tabs}>
                          {[7, 14].map((days) => (
                            <Pressable key={days} style={[styles.tab, visitForm.boletoDays === days && styles.tabA]} onPress={() => setVisitForm((p) => ({ ...p, boletoDays: days }))}>
                              <Text style={[styles.tabT, visitForm.boletoDays === days && styles.tabTA]}>{days} dias</Text>
                            </Pressable>
                          ))}
                        </View>
                      </>
                    )}
                    <TextInput style={styles.i} placeholderTextColor="#8f816f" placeholder="Monto cobrado (0 si no cobraste)" value={visitForm.amountCollected} onChangeText={(t) => setVisitForm((p) => ({ ...p, amountCollected: t }))} keyboardType="decimal-pad" />
                  </>
                )}
                <Text style={styles.t}>Producto</Text>
                <TextInput style={styles.i} placeholderTextColor="#8f816f" placeholder={visitEntryType === "count_only" ? "Producto para conteo" : "Producto"} value={itemDraft.productName} onChangeText={(t) => setItemDraft((p) => ({ ...p, productName: t, productId: "" }))} />
                <View style={styles.rowBtns}>{productOptions.slice(0, 6).map((p) => <Pressable key={p.id} style={styles.quick} onPress={() => setItemDraft((d) => ({ ...d, productId: p.id, productName: p.name, unitPrice: String(num(p.unitPrice)) }))}><Text style={styles.quickT}>{p.name}</Text></Pressable>)}</View>
                {visitEntryType === "degustacion" && (
                  <TextInput style={styles.i} placeholderTextColor="#8f816f" placeholder="Cantidad para degustacion" value={itemDraft.quantity} onChangeText={(t) => setItemDraft((p) => ({ ...p, quantity: t }))} keyboardType="decimal-pad" />
                )}
                {visitEntryType === "dispatch" && (
                  <>
                    <TextInput style={styles.i} placeholderTextColor="#8f816f" placeholder="Cantidad" value={itemDraft.quantity} onChangeText={(t) => setItemDraft((p) => ({ ...p, quantity: t }))} keyboardType="decimal-pad" />
                    <TextInput style={styles.i} placeholderTextColor="#8f816f" placeholder="Valor unitario" value={itemDraft.unitPrice} onChangeText={(t) => setItemDraft((p) => ({ ...p, unitPrice: t }))} keyboardType="decimal-pad" />
                  </>
                )}
                {visitEntryType !== "degustacion" && (
                  <TextInput style={styles.i} placeholderTextColor="#8f816f" placeholder={visitEntryType === "count_only" ? "Cantidad disponible en cliente" : "Restante actual"} value={itemDraft.remaining} onChangeText={(t) => setItemDraft((p) => ({ ...p, remaining: t }))} keyboardType="decimal-pad" />
                )}
                {Platform.OS === "web" ? (
                  <TextInput
                    style={styles.i}
                    placeholderTextColor="#8f816f"
                    placeholder="Proxima visita (AAAA-MM-DD)"
                    value={visitForm.nextVisitDate}
                    onChangeText={(t) => setVisitForm((p) => ({ ...p, nextVisitDate: t }))}
                  />
                ) : (
                  <>
                    <Pressable style={styles.i} onPress={() => setShowVisitNextDatePicker(true)}>
                      <Text style={styles.datePickerText}>{visitForm.nextVisitDate ? `Proxima visita: ${visitForm.nextVisitDate}` : "Seleccionar proxima visita (calendario)"}</Text>
                    </Pressable>
                    {showVisitNextDatePicker && (
                      <DateTimePicker
                        value={visitForm.nextVisitDate ? new Date(`${visitForm.nextVisitDate}T00:00:00`) : new Date()}
                        mode="date"
                        display="default"
                        onChange={onChangeVisitNextDate}
                      />
                    )}
                  </>
                )}
                <Pressable style={styles.copy} onPress={addVisitItem}><Text style={styles.copyT}>Agregar producto</Text></Pressable>
                {visitItems.map((it) => <View key={it.id} style={styles.item}><Text style={styles.itemT}>{it.productName}</Text><Text style={styles.s}>{visitEntryType === "count_only" ? `Disponible ${num(it.remaining).toFixed(2)} unid` : visitEntryType === "degustacion" ? `Degustacion ${num(it.quantity).toFixed(2)} unid` : `Cant ${num(it.quantity).toFixed(2)} | Restante ${num(it.remaining).toFixed(2)} | Total ${num(it.total).toFixed(2)}`}</Text></View>)}
                <View style={styles.modalActions}>
                  <Pressable style={styles.copy} onPress={() => { setShowVisitFormModal(false); setVisitEntryType("dispatch"); }}><Text style={styles.copyT}>Cancelar</Text></Pressable>
                  <Pressable style={styles.btnMini} onPress={saveVisit}><Text style={styles.btnT}>Guardar visita</Text></Pressable>
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>
      )}

      {showAgendaFormModal && (
        <Modal transparent visible={showAgendaFormModal} animationType="fade" onRequestClose={() => setShowAgendaFormModal(false)}>
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <Text style={styles.t}>Agendar visita</Text>
              <View style={styles.selectorShell}>
                <TextInput
                  style={styles.selectorInput}
                  placeholderTextColor="#8f816f" placeholder="Buscar cliente (ID / comercio / responsable)"
                  value={apptClientQuery}
                  onChangeText={(t) => {
                    setApptClientQuery(t);
                    setApptForm((p) => ({ ...p, clientId: "" }));
                    setShowApptClientSuggestions(true);
                  }}
                />
                <Pressable style={styles.selectorBtn} onPress={() => { setApptClientQuery(""); setApptForm((p) => ({ ...p, clientId: "" })); setShowApptClientSuggestions(false); }}>
                  <Text style={styles.selectorBtnTxt}>X</Text>
                </Pressable>
                <Pressable style={styles.selectorBtn} onPress={() => setShowApptClientSuggestions((p) => !p)}>
                  <Text style={styles.selectorBtnTxt}>{showApptClientSuggestions ? "^" : "?"}</Text>
                </Pressable>
              </View>
              {showApptClientSuggestions && (
                <View style={styles.dropdown}>
                  {filteredApptClientOptions.slice(0, 10).map((client) => (
                    <Pressable key={client.id} style={styles.dropdownItem} onPress={() => { setApptForm((p) => ({ ...p, clientId: client.id })); setApptClientQuery(`${client.name} (${client.internalId || client.id})`); setShowApptClientSuggestions(false); }}>
                      <Text style={styles.itemT}>{client.name}</Text>
                      <Text style={styles.s}>{client.internalId || client.id} | {client.buyer || "-"}</Text>
                    </Pressable>
                  ))}
                  {filteredApptClientOptions.length === 0 ? <Text style={styles.s}>Sin clientes con ese filtro.</Text> : null}
                </View>
              )}
              {Platform.OS === "web" ? (
                <TextInput
                  style={styles.i}
                  placeholderTextColor="#8f816f"
                  placeholder="Fecha (AAAA-MM-DD)"
                  value={apptForm.date}
                  onChangeText={(t) => setApptForm((p) => ({ ...p, date: t }))}
                />
              ) : (
                <>
                  <Pressable style={styles.i} onPress={() => setShowApptDatePicker(true)}>
                    <Text style={styles.datePickerText}>{apptForm.date ? `Fecha: ${apptForm.date}` : "Seleccionar fecha (calendario)"}</Text>
                  </Pressable>
                  {showApptDatePicker && (
                    <DateTimePicker
                      value={apptForm.date ? new Date(`${apptForm.date}T00:00:00`) : new Date()}
                      mode="date"
                      display="default"
                      onChange={onChangeApptDate}
                    />
                  )}
                </>
              )}
              <TextInput style={[styles.i, { minHeight: 80 }]} multiline placeholderTextColor="#8f816f" placeholder="Notas" value={apptForm.notes} onChangeText={(t) => setApptForm((p) => ({ ...p, notes: t }))} />
              <View style={styles.modalActions}>
                <Pressable style={styles.copy} onPress={() => setShowAgendaFormModal(false)}><Text style={styles.copyT}>Cancelar</Text></Pressable>
                <Pressable style={styles.btnMini} onPress={saveAppointment}><Text style={styles.btnT}>Guardar</Text></Pressable>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {(tab === "clientes" || tab === "visitas" || tab === "agenda") && (
        <>
          {tab === "visitas" && showVisitTypeMenu && (
            <View style={[styles.fabMenu, { bottom: 90 + Math.max(insets.bottom, 10) }]}>
              <Pressable style={styles.fabMenuItem} onPress={() => openVisitModalWithType("dispatch")}>
                <Text style={styles.fabMenuText}>Con despacho</Text>
              </Pressable>
              <Pressable style={styles.fabMenuItem} onPress={() => openVisitModalWithType("count_only")}>
                <Text style={styles.fabMenuText}>Solo conteo</Text>
              </Pressable>
              <Pressable style={styles.fabMenuItem} onPress={() => openVisitModalWithType("degustacion")}>
                <Text style={styles.fabMenuText}>Degustacion</Text>
              </Pressable>
            </View>
          )}
          <Pressable
            style={[styles.fab, { bottom: 24 + Math.max(insets.bottom, 10) }]}
            onPress={() => {
              if (tab === "clientes") {
                setShowClientForm((p) => {
                  const next = !p;
                  if (next) {
                    setClientForm({ tradeName: "", buyerName: "", cep: "", addressStreet: "", addressNumber: "", addressNeighborhood: "", addressCity: "", addressState: "", location: "", type: "", phone: "", email: "", cpf: "", cnpj: "", ie: "", observations: "" });
                  }
                  return next;
                });
              }
              if (tab === "visitas") setShowVisitTypeMenu((p) => !p);
              if (tab === "agenda") setShowAgendaFormModal(true);
            }}
          >
            <Text style={styles.fabT}>{tab === "visitas" && showVisitTypeMenu ? "x" : "+"}</Text>
          </Pressable>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#fff8ef" },
  wrap: { padding: 14, paddingBottom: 24 },
  topBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  topBtn: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#e6d3bc", borderRadius: 12, paddingVertical: 7, paddingHorizontal: 14 },
  topBtnGhost: { width: 44, height: 36 },
  topBtnText: { color: "#5d4730", fontWeight: "800", fontSize: 18 },
  heroLogoWrap: { alignItems: "center", marginBottom: 8 },
  heroLogo: { width: 84, height: 84, opacity: 0.95 },
  card: { backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: "#f0dfca", padding: 12, marginTop: 10 },
  h: { fontSize: 24, fontWeight: "800", color: "#2a221a" },
  t: { fontSize: 16, fontWeight: "800", color: "#2f251d", marginTop: 6 },
  s: { color: "#7d7266", marginTop: 3 },
  i: { borderWidth: 1, borderColor: "#dfcfbb", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, marginTop: 8, backgroundColor: "#fffdf9", color: "#2f251d" },
  pinRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  pinInput: { flex: 1 },
  pinToggle: { marginTop: 8, backgroundColor: "#f1e3d2", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, alignItems: "center", justifyContent: "center" },
  datePickerText: { color: "#2f251d", fontWeight: "600" },
  selectorShell: { marginTop: 8, minHeight: 42, borderRadius: 10, backgroundColor: "#fffdf9", borderWidth: 1, borderColor: "#dfcfbb", flexDirection: "row", alignItems: "center", paddingLeft: 10, paddingRight: 6 },
  selectorInput: { flex: 1, color: "#2f251d", fontSize: 14, fontWeight: "500", paddingVertical: 8, paddingRight: 6 },
  selectorBtn: { width: 30, height: 30, borderRadius: 7, marginLeft: 6, backgroundColor: "#f1e3d2", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#dfcfbb" },
  selectorBtnTxt: { color: "#5f4a32", fontWeight: "800", fontSize: 11 },
  dropdown: { marginTop: 8, borderWidth: 1, borderColor: "#dfcfbb", borderRadius: 10, backgroundColor: "#fffdf9", padding: 8, gap: 6 },
  dropdownItem: { borderWidth: 1, borderColor: "#f0dfca", borderRadius: 10, paddingVertical: 8, paddingHorizontal: 8, backgroundColor: "#fff" },
  btn: { marginTop: 12, backgroundColor: "#d96d20", paddingVertical: 12, borderRadius: 10, alignItems: "center" },
  btnDisabled: { opacity: 0.55 },
  btnT: { color: "#fff", fontWeight: "800" },
  copy: { marginTop: 8, backgroundColor: "#f1e3d2", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, alignItems: "center" },
  copyT: { color: "#704f2b", fontWeight: "700", fontSize: 12 },
  err: { color: "#b20000", marginTop: 8 },
  tabs: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  tab: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 20, backgroundColor: "#f6efe6" },
  tabA: { backgroundColor: "#d96d20" },
  tabT: { color: "#6c5b48", fontWeight: "700", fontSize: 12 },
  tabTA: { color: "#fff" },
  item: { borderWidth: 1, borderColor: "#eadfce", borderRadius: 10, padding: 8, marginTop: 8, backgroundColor: "#fffdf9" },
  itemT: { color: "#2f251d", fontWeight: "700" },
  rowBtns: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 8 },
  quick: { backgroundColor: "#f1e3d2", paddingVertical: 6, paddingHorizontal: 8, borderRadius: 8 },
  quickT: { color: "#704f2b", fontWeight: "700", fontSize: 11 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(24,18,13,0.45)", justifyContent: "center", padding: 16 },
  modalCard: { backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: "#f0dfca", padding: 12, maxHeight: "88%" },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 10 },
  btnMini: { backgroundColor: "#d96d20", borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  fabMenu: { position: "absolute", right: 22, bottom: 90, backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#f0dfca", overflow: "hidden" },
  fabMenuItem: { paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#f3e7d8" },
  fabMenuText: { color: "#5d4730", fontWeight: "700" },
  fab: { position: "absolute", right: 22, bottom: 24, width: 58, height: 58, borderRadius: 29, backgroundColor: "#d96d20", alignItems: "center", justifyContent: "center", elevation: 4 },
  fabT: { color: "#fff", fontSize: 30, lineHeight: 32, fontWeight: "700" }
});

