import React, { useMemo, useState } from "react";
import { View, Text, ScrollView, TextInput, Pressable, StyleSheet, Alert, RefreshControl, Image, Modal } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import DateTimePicker from "@react-native-community/datetimepicker";

const API_BASE = (process.env.EXPO_PUBLIC_API_URL || "http://localhost:4000/api").replace(/\/$/, "");
const today = () => new Date().toISOString().slice(0, 10);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const digits = (v) => String(v || "").replace(/\D/g, "");
const availabilitySourceLabel = (source) => (String(source || "").toLowerCase() === "conteo" ? "conteo" : "estimado");
const LOGO = require("./assets/logo-platanito.jpg");
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
  const [token, setToken] = useState("");
  const [tab, setTab] = useState("resumen");
  const [loading, setLoading] = useState(false);
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
    type: "bodega",
    phone: "",
    email: "",
    cnpj: "",
    ie: "",
    observations: ""
  });

  const [visitForm, setVisitForm] = useState({ date: today(), clientId: "", amountCollected: "", collectionMethod: "efectivo", saleType: "consignado", boletoDays: 7, nextVisitDate: "", notes: "" });
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
      const cep = String(c.cep || "").toLowerCase();
      return name.includes(q) || buyer.includes(q) || cnpj.includes(q) || cep.includes(q);
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
    setData({ seller: null, summary: {}, clients: [], agendaWeek: [], visitsHistory: [], stock: [], products: [], paymentsByMethod: {}, productGoals: [], productGoalProgress: [] });
    setVisitItems([]);
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

  async function lookupCep() {
    const cep = digits(clientForm.cep);
    if (cep.length !== 8) return Alert.alert("Error", "CEP invalido (8 digitos)");
    try {
      const d = await apiGet(`/lookup/cep/${cep}`);
      const location = [d.street, d.neighborhood, d.city, d.state].filter(Boolean).join(", ");
      setClientForm((p) => ({
        ...p,
        cep,
        addressStreet: d.street || "",
        addressNeighborhood: d.neighborhood || "",
        addressCity: d.city || "",
        addressState: d.state || "",
        location: location || p.location
      }));
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
      setClientForm((p) => ({
        ...p,
        cnpj,
        tradeName: d.tradeName || p.tradeName,
        email: d.email || p.email,
        phone: d.phone || p.phone,
        ie: d.ie || p.ie,
        cep: d.cep || p.cep,
        addressStreet: d.street || p.addressStreet,
        addressNumber: d.number || p.addressNumber,
        addressNeighborhood: d.neighborhood || p.addressNeighborhood,
        addressCity: d.city || p.addressCity,
        addressState: d.state || p.addressState,
        location: location || p.location
      }));
    } catch (e) {
      Alert.alert("Error", e.message || "No fue posible consultar CNPJ");
    }
  }

  async function createClient() {
    if (!clientForm.tradeName.trim()) return Alert.alert("Error", "Nombre comercio obligatorio");
    try {
      await apiPostAuth("/seller-app/clients", clientForm);
      setClientForm({ tradeName: "", buyerName: "", cep: "", addressStreet: "", addressNumber: "", addressNeighborhood: "", addressCity: "", addressState: "", location: "", type: "bodega", phone: "", email: "", cnpj: "", ie: "", observations: "" });
      await loadSellerData();
      Alert.alert("Listo", "Cliente creado y asignado");
    } catch (e) {
      Alert.alert("Error", e.message || "No se pudo crear cliente");
    }
  }

  function addVisitItem() {
    if (!itemDraft.productName.trim()) return Alert.alert("Error", "Producto obligatorio");
    if (String(itemDraft.remaining).trim() === "") return Alert.alert("Error", "Restante obligatorio");
    if (visitEntryType !== "count_only" && String(itemDraft.quantity).trim() === "") return Alert.alert("Error", "Cantidad obligatoria");
    const quantity = visitEntryType === "count_only" ? 0 : num(itemDraft.quantity);
    const unitPrice = visitEntryType === "count_only" ? 0 : num(itemDraft.unitPrice);
    const line = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      productId: itemDraft.productId || "",
      productName: itemDraft.productName.trim(),
      quantity,
      unitPrice,
      total: quantity * unitPrice,
      remaining: num(itemDraft.remaining)
    };
    setVisitItems((p) => [...p, line]);
    setItemDraft({ productId: "", productName: "", quantity: "", unitPrice: "", remaining: "" });
  }

  async function saveVisit() {
    if (!visitForm.clientId) return Alert.alert("Error", "Cliente obligatorio");
    if (!visitForm.date) return Alert.alert("Error", "Fecha obligatoria");
    if (String(visitForm.amountCollected).trim() === "") return Alert.alert("Error", "Monto cobrado obligatorio (usa 0)");
    if (visitItems.length === 0) return Alert.alert("Error", visitEntryType === "count_only" ? "Agrega al menos un producto para conteo" : "Agrega al menos un producto");
    if (visitEntryType === "count_only" && visitForm.saleType === "consignado") return Alert.alert("Error", "En visita solo conteo, usa A vista o Boleto.");
    try {
      await apiPostAuth("/seller-app/visits", {
        ...visitForm,
        visitType: visitEntryType,
        collectionMethod:
          visitForm.saleType === "boleto"
            ? "boleto"
            : visitForm.saleType === "consignado"
              ? ""
              : visitForm.collectionMethod || "efectivo",
        amountCollected: num(visitForm.amountCollected),
        paymentType: visitForm.saleType === "a_vista" ? "contado" : "consignado",
        items: visitItems,
        delivered: visitEntryType === "count_only" ? 0 : visitItems.reduce((acc, i) => acc + num(i.quantity), 0),
        remaining: 0
      });
      setVisitForm({ date: today(), clientId: "", amountCollected: "", collectionMethod: "efectivo", saleType: "consignado", boletoDays: 7, nextVisitDate: "", notes: "" });
      setVisitClientQuery("");
      setShowVisitClientSuggestions(false);
      setVisitItems([]);
      setVisitEntryType("dispatch");
      setShowVisitFormModal(false);
      await loadSellerData();
      Alert.alert("Listo", "Visita registrada");
    } catch (e) {
      Alert.alert("Error", e.message || "No se pudo guardar visita");
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
      setVisitForm((p) => ({ ...p, saleType: "a_vista", collectionMethod: "efectivo" }));
    } else {
      setVisitForm((p) => ({ ...p, saleType: "consignado", collectionMethod: "" }));
    }
    setShowVisitTypeMenu(false);
    setShowVisitFormModal(true);
  }

  if (!token) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <StatusBar style="dark" />
        <View style={styles.wrap}>
          <View style={styles.card}>
            <Text style={styles.h}>App Vendedor</Text>
            <Text style={styles.s}>VeDistribuidora</Text>
            <TextInput style={styles.i} placeholder="Usuario" value={loginForm.username} onChangeText={(t) => setLoginForm((p) => ({ ...p, username: t }))} autoCapitalize="none" />
            <TextInput style={styles.i} placeholder="PIN" value={loginForm.pin} onChangeText={(t) => setLoginForm((p) => ({ ...p, pin: t }))} secureTextEntry keyboardType="numeric" />
            {error ? <Text style={styles.err}>{error}</Text> : null}
            <Pressable style={styles.btn} onPress={login} disabled={loading}><Text style={styles.btnT}>{loading ? "Entrando..." : "Entrar"}</Text></Pressable>
            <Text style={styles.s}>Demo inicial: `edwin` / `1234`</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={styles.wrap}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#d96d20" />}
      >
        <View style={styles.card}>
          <View style={styles.heroLogoWrap}>
            <Image source={LOGO} style={styles.heroLogo} resizeMode="contain" />
          </View>
          <Text style={styles.h}>{data.seller?.name || "-"}</Text>
          <Text style={styles.s}>Ventas semana: {num(data.summary?.weekSales).toFixed(2)} | Mes: {num(data.summary?.monthSales).toFixed(2)}</Text>
          <Text style={styles.s}>Comision mes: {num(data.summary?.commissionAmount).toFixed(2)} | Deuda cartera: {num(data.summary?.totalDebt).toFixed(2)}</Text>
          <View style={styles.rowBtns}>
            <Pressable style={styles.copy} onPress={() => loadSellerData()}><Text style={styles.copyT}>Actualizar</Text></Pressable>
            <Pressable style={styles.copy} onPress={logout}><Text style={styles.copyT}>Salir</Text></Pressable>
          </View>
        </View>

        <View style={styles.tabs}>{[["resumen", "Metas"], ["clientes", "Clientes"], ["agenda", "Agenda"], ["visitas", "Visitas"], ["stock", "Stock disponible"]].map(([id, t]) => (
          <Pressable key={id} style={[styles.tab, tab === id && styles.tabA]} onPress={() => { setTab(id); if (id !== "visitas") setSelectedVisitId(""); setShowVisitTypeMenu(false); }}><Text style={[styles.tabT, tab === id && styles.tabTA]}>{t}</Text></Pressable>
        ))}</View>

        {tab === "resumen" && (
          <View style={styles.card}>
            <Text style={styles.t}>Meta por producto</Text>
            <TextInput style={styles.i} placeholder="Producto" value={productGoalForm.productName} onChangeText={(t) => setProductGoalForm((p) => ({ ...p, productName: t, productId: "" }))} />
            <View style={styles.rowBtns}>{productOptions.slice(0, 8).map((p) => <Pressable key={p.id} style={styles.quick} onPress={() => setProductGoalForm((d) => ({ ...d, productId: p.id, productName: p.name }))}><Text style={styles.quickT}>{p.name}</Text></Pressable>)}</View>
            <TextInput style={styles.i} placeholder="Cantidad objetivo semanal (unid)" value={productGoalForm.targetQty} onChangeText={(t) => setProductGoalForm((p) => ({ ...p, targetQty: t }))} keyboardType="decimal-pad" />
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
              <TextInput style={styles.i} placeholder="Buscar por nombre, CNPJ o CEP" value={clientFilter} onChangeText={setClientFilter} />
              {filteredClients.map((c) => {
                const availability = Array.isArray(c.productAvailability) && c.productAvailability.length > 0
                  ? c.productAvailability
                  : computeAvailabilityFromVisits(data.visitsHistory || [], c.id);
                return (
                <View key={c.id} style={styles.item}>
                  <Text style={styles.itemT}>{c.tradeName}</Text>
                  <Text style={styles.s}>{c.internalId || c.id} | Deuda: {num(c.debt).toFixed(2)}</Text>
                  <Text style={styles.s}>CNPJ: {c.cnpj || "-"} | CEP: {c.cep || "-"}</Text>
                  {availability.map((item, idx) => (
                    <Text key={`${c.id}_pa_${idx}`} style={styles.s}>
                      Disponible {item.productName}: {num(item.availableQty).toFixed(2)} unid ({availabilitySourceLabel(item.source)})
                    </Text>
                  ))}
                </View>
              );})}
              {filteredClients.length === 0 ? <Text style={styles.s}>Sin clientes con ese filtro.</Text> : null}
            </View>
            {showClientForm && (
              <View style={styles.card}>
                <Text style={styles.t}>Registrar cliente</Text>
                <TextInput style={styles.i} placeholder="Nombre comercio" value={clientForm.tradeName} onChangeText={(t) => setClientForm((p) => ({ ...p, tradeName: t }))} />
                <TextInput style={styles.i} placeholder="Responsable compras" value={clientForm.buyerName} onChangeText={(t) => setClientForm((p) => ({ ...p, buyerName: t }))} />
                <TextInput style={styles.i} placeholder="CEP" value={clientForm.cep} onChangeText={(t) => setClientForm((p) => ({ ...p, cep: t }))} keyboardType="numeric" />
                <Pressable style={styles.copy} onPress={lookupCep}><Text style={styles.copyT}>Buscar CEP</Text></Pressable>
                <TextInput style={styles.i} placeholder="CNPJ" value={clientForm.cnpj} onChangeText={(t) => setClientForm((p) => ({ ...p, cnpj: t }))} keyboardType="numeric" />
                <Pressable style={styles.copy} onPress={lookupCnpj}><Text style={styles.copyT}>Buscar CNPJ</Text></Pressable>
                <TextInput style={styles.i} placeholder="Ubicacion" value={clientForm.location} onChangeText={(t) => setClientForm((p) => ({ ...p, location: t }))} />
                <TextInput style={styles.i} placeholder="Tipo comercio" value={clientForm.type} onChangeText={(t) => setClientForm((p) => ({ ...p, type: t }))} />
                <TextInput style={styles.i} placeholder="Telefono" value={clientForm.phone} onChangeText={(t) => setClientForm((p) => ({ ...p, phone: t }))} />
                <TextInput style={styles.i} placeholder="Correo" value={clientForm.email} onChangeText={(t) => setClientForm((p) => ({ ...p, email: t }))} />
                <TextInput style={styles.i} placeholder="IE" value={clientForm.ie} onChangeText={(t) => setClientForm((p) => ({ ...p, ie: t }))} />
                <TextInput style={styles.i} placeholder="Observaciones" value={clientForm.observations} onChangeText={(t) => setClientForm((p) => ({ ...p, observations: t }))} />
                <Pressable style={styles.btn} onPress={createClient}><Text style={styles.btnT}>Guardar cliente</Text></Pressable>
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
              <Text style={styles.s}>Cliente: {selectedVisit.clientName || "-"}</Text>
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
      {showVisitFormModal && (
        <Modal transparent visible={showVisitFormModal} animationType="fade" onRequestClose={() => setShowVisitFormModal(false)}>
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <ScrollView contentContainerStyle={{ paddingBottom: 8 }}>
                <Text style={styles.t}>{visitEntryType === "count_only" ? "Registrar visita (solo conteo)" : "Registrar visita (con despacho)"}</Text>
                {visitEntryType === "count_only" ? <Text style={styles.s}>Modo conteo: no descuenta stock, solo registra mercancia disponible.</Text> : null}
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
                <View style={styles.selectorShell}>
                  <TextInput
                    style={styles.selectorInput}
                    placeholder="Buscar cliente (ID / comercio / responsable)"
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
                    <Text style={styles.selectorBtnTxt}>{showVisitClientSuggestions ? "˄" : "˅"}</Text>
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
                <TextInput style={styles.i} placeholder="Monto cobrado (0 si no cobraste)" value={visitForm.amountCollected} onChangeText={(t) => setVisitForm((p) => ({ ...p, amountCollected: t }))} keyboardType="decimal-pad" />
                <Text style={styles.t}>Producto</Text>
                <TextInput style={styles.i} placeholder={visitEntryType === "count_only" ? "Producto para conteo" : "Producto"} value={itemDraft.productName} onChangeText={(t) => setItemDraft((p) => ({ ...p, productName: t, productId: "" }))} />
                <View style={styles.rowBtns}>{productOptions.slice(0, 6).map((p) => <Pressable key={p.id} style={styles.quick} onPress={() => setItemDraft((d) => ({ ...d, productId: p.id, productName: p.name, unitPrice: String(num(p.unitPrice)) }))}><Text style={styles.quickT}>{p.name}</Text></Pressable>)}</View>
                {visitEntryType !== "count_only" && (
                  <>
                    <TextInput style={styles.i} placeholder="Cantidad" value={itemDraft.quantity} onChangeText={(t) => setItemDraft((p) => ({ ...p, quantity: t }))} keyboardType="decimal-pad" />
                    <TextInput style={styles.i} placeholder="Valor unitario" value={itemDraft.unitPrice} onChangeText={(t) => setItemDraft((p) => ({ ...p, unitPrice: t }))} keyboardType="decimal-pad" />
                  </>
                )}
                <TextInput style={styles.i} placeholder={visitEntryType === "count_only" ? "Cantidad disponible en cliente" : "Restante actual"} value={itemDraft.remaining} onChangeText={(t) => setItemDraft((p) => ({ ...p, remaining: t }))} keyboardType="decimal-pad" />
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
                <Pressable style={styles.copy} onPress={addVisitItem}><Text style={styles.copyT}>Agregar producto</Text></Pressable>
                {visitItems.map((it) => <View key={it.id} style={styles.item}><Text style={styles.itemT}>{it.productName}</Text><Text style={styles.s}>{visitEntryType === "count_only" ? `Disponible ${num(it.remaining).toFixed(2)} unid` : `Cant ${num(it.quantity).toFixed(2)} | Restante ${num(it.remaining).toFixed(2)} | Total ${num(it.total).toFixed(2)}`}</Text></View>)}
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
                  placeholder="Buscar cliente (ID / comercio / responsable)"
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
                  <Text style={styles.selectorBtnTxt}>{showApptClientSuggestions ? "˄" : "˅"}</Text>
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
              <TextInput style={[styles.i, { minHeight: 80 }]} multiline placeholder="Notas" value={apptForm.notes} onChangeText={(t) => setApptForm((p) => ({ ...p, notes: t }))} />
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
            <View style={styles.fabMenu}>
              <Pressable style={styles.fabMenuItem} onPress={() => openVisitModalWithType("dispatch")}>
                <Text style={styles.fabMenuText}>Con despacho</Text>
              </Pressable>
              <Pressable style={styles.fabMenuItem} onPress={() => openVisitModalWithType("count_only")}>
                <Text style={styles.fabMenuText}>Solo conteo</Text>
              </Pressable>
            </View>
          )}
          <Pressable
            style={styles.fab}
            onPress={() => {
              if (tab === "clientes") setShowClientForm((p) => !p);
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
  heroLogoWrap: { alignItems: "center", marginBottom: 8 },
  heroLogo: { width: 84, height: 84, opacity: 0.95 },
  card: { backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: "#f0dfca", padding: 12, marginTop: 10 },
  h: { fontSize: 24, fontWeight: "800", color: "#2a221a" },
  t: { fontSize: 16, fontWeight: "800", color: "#2f251d", marginTop: 6 },
  s: { color: "#7d7266", marginTop: 3 },
  i: { borderWidth: 1, borderColor: "#dfcfbb", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, marginTop: 8, backgroundColor: "#fffdf9" },
  datePickerText: { color: "#2f251d", fontWeight: "600" },
  selectorShell: { marginTop: 8, minHeight: 42, borderRadius: 10, backgroundColor: "#fffdf9", borderWidth: 1, borderColor: "#dfcfbb", flexDirection: "row", alignItems: "center", paddingLeft: 10, paddingRight: 6 },
  selectorInput: { flex: 1, color: "#2f251d", fontSize: 14, fontWeight: "500", paddingVertical: 8, paddingRight: 6 },
  selectorBtn: { width: 30, height: 30, borderRadius: 7, marginLeft: 6, backgroundColor: "#f1e3d2", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#dfcfbb" },
  selectorBtnTxt: { color: "#5f4a32", fontWeight: "800", fontSize: 11 },
  dropdown: { marginTop: 8, borderWidth: 1, borderColor: "#dfcfbb", borderRadius: 10, backgroundColor: "#fffdf9", padding: 8, gap: 6 },
  dropdownItem: { borderWidth: 1, borderColor: "#f0dfca", borderRadius: 10, paddingVertical: 8, paddingHorizontal: 8, backgroundColor: "#fff" },
  btn: { marginTop: 12, backgroundColor: "#d96d20", paddingVertical: 12, borderRadius: 10, alignItems: "center" },
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

