import React from "react";
import logoPlatanito from "./assets/logo-platanito.jpg";

const API_BASE = (import.meta.env.VITE_API_URL || "http://localhost:4000/api").replace(/\/$/, "");
const tabs = [["dashboard", "Panel"],["clients", "Clientes"],["visits", "Visitas"],["products", "Productos"],["inventory", "Inventario"],["sellers", "Vendedores"],["reports", "Reportes"]];

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
  const [tab, setTab] = React.useState("dashboard");
  const [data, setData] = React.useState({ clients: [], visits: [], products: [], inventory: [], sellers: [], sellerOverview: [], dashboard: { totalSoldThisWeek: 0, totalDebt: 0, clientsNeedingVisit: [], topClients: [] } });
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
  const [clientEditId, setClientEditId] = React.useState("");
  const [clientEditForm, setClientEditForm] = React.useState(null);

  const [clientForm, setClientForm] = React.useState(CLIENT_FORM_INITIAL);
  const [visitForm, setVisitForm] = React.useState({ date: new Date().toISOString().slice(0, 10), clientId: "", saleType: "consignado", amountCollected: "0", nextVisitDate: "", notes: "", productId: "", quantity: "", unitPrice: "", remaining: "" });
  const [productForm, setProductForm] = React.useState({ name: "", unitPrice: "" });
  const [inventoryForm, setInventoryForm] = React.useState({ productId: "", quantity: "" });
  const [inventoryDraft, setInventoryDraft] = React.useState({});
  const [transferForm, setTransferForm] = React.useState({ sellerId: "", productId: "", quantity: "" });
  const sellers = React.useMemo(() => (data.sellers || []).filter((s) => s.role === "seller" && s.active), [data.sellers]);

  async function loadAll() {
    try {
      setLoading(true); setError("");
      const payload = await apiGet("/data");
      setData(payload);
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
    if (!visitForm.clientId || !product) return setError("Cliente y producto obligatorios");
    if (String(visitForm.remaining).trim() === "") return setError("Restante obligatorio");
    const qty = num(visitForm.quantity);
    if (qty <= 0) return setError("Cantidad debe ser mayor a 0");
    const price = num(visitForm.unitPrice || product.unitPrice);
    try {
      await apiPost("/visits", {
        clientId: visitForm.clientId,
        date: visitForm.date,
        saleType: visitForm.saleType,
        amountCollected: num(visitForm.amountCollected),
        nextVisitDate: visitForm.nextVisitDate,
        notes: visitForm.notes,
        paymentType: visitForm.saleType === "a_vista" ? "contado" : "consignado",
        items: [{ productId: product.id, productName: product.name, quantity: qty, unitPrice: price, total: qty * price, remaining: num(visitForm.remaining) }],
        delivered: qty,
        remaining: 0
      });
      setVisitForm({ date: new Date().toISOString().slice(0, 10), clientId: "", saleType: "consignado", amountCollected: "0", nextVisitDate: "", notes: "", productId: "", quantity: "", unitPrice: "", remaining: "" });
      setOk("Visita guardada");
      await loadAll();
      setTab("visits");
    } catch (err) { setError(err.message || "Error"); }
  }

  async function saveProduct(e) {
    e.preventDefault();
    try {
      await apiPost("/products", { name: productForm.name, unitPrice: num(productForm.unitPrice), active: true });
      setProductForm({ name: "", unitPrice: "" });
      setOk("Producto guardado");
      await loadAll();
    } catch (err) { setError(err.message || "Error"); }
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

      {!loading && tab === "clients" && <section className="panel"><h3>Clientes</h3><ul className="simple-list">{(data.clients || []).map((c) => <li key={c.id}><div><span>{c.tradeName || c.name}</span><small>{c.type || "-"} | {c.location || "Sin ubicacion"}</small><small>Responsable: {c.buyerName || c.contact || "-"}</small><small>CPF/CNPJ: {c.cpf || "-"} / {c.cnpj || "-"}</small>{clientEditId === c.id && clientEditForm ? <form className="form inlineForm" onSubmit={saveClientEdit}><label>Nombre comercio<input required value={clientEditForm.tradeName} onChange={(e) => setClientEditForm((d) => ({ ...(d || {}), tradeName: e.target.value }))} /></label><label>Responsable<input value={clientEditForm.buyerName} onChange={(e) => setClientEditForm((d) => ({ ...(d || {}), buyerName: e.target.value }))} /></label><label>Ubicacion<input value={clientEditForm.location} onChange={(e) => setClientEditForm((d) => ({ ...(d || {}), location: e.target.value }))} /></label><label>Tipo<input value={clientEditForm.type} onChange={(e) => setClientEditForm((d) => ({ ...(d || {}), type: e.target.value }))} /></label><label>Telefono<input value={clientEditForm.phone} onChange={(e) => setClientEditForm((d) => ({ ...(d || {}), phone: e.target.value }))} /></label><label>Email<input value={clientEditForm.email} onChange={(e) => setClientEditForm((d) => ({ ...(d || {}), email: e.target.value }))} /></label><label>CPF<input value={clientEditForm.cpf || ""} onChange={(e) => setClientEditForm((d) => ({ ...(d || {}), cpf: e.target.value }))} /></label><label>CNPJ<input value={clientEditForm.cnpj || ""} onChange={(e) => setClientEditForm((d) => ({ ...(d || {}), cnpj: e.target.value }))} /></label><div className="miniActions"><button className="secondary btnMini" type="submit">Guardar cambios</button><button className="btnMini" type="button" onClick={cancelEditClient}>Cancelar</button></div></form> : null}</div><div className="rightCol"><strong>{money(c.debt)}</strong><div className="miniActions"><button className="secondary btnMini" type="button" onClick={() => beginEditClient(c)}>Editar</button><button className="danger btnMini" type="button" onClick={() => removeClient(c)}>Eliminar</button></div></div></li>)}</ul></section>}

      {!loading && tab === "visits" && <section className="panel"><h3>Visitas</h3><ul className="simple-list">{[...(data.visits || [])].sort((a, b) => new Date(b.date) - new Date(a.date)).map((v) => { const c = data.clients.find((x) => x.id === v.clientId); const saleType = String(v.saleType || v.paymentType || "").toLowerCase(); const visitTotal = num(v.totalValue ?? v.soldAmount); const pending = Math.max(0, visitTotal - num(v.amountCollected)); const canMarkPaid = (saleType === "boleto" || saleType === "consignado") && pending > 0; const visitRow = { ...v, clientName: c?.tradeName || c?.name || "Cliente" }; return <li key={v.id}><div><span>{c?.tradeName || c?.name || "Cliente"}</span><small>{date(v.date)} | {v.saleType || v.paymentType}</small><small>Total: {money(v.totalValue ?? v.soldAmount)} | Cobrado: {money(v.amountCollected)}</small></div><div className="rightCol"><div className="miniActions">{canMarkPaid ? <button className="secondary btnMini" type="button" onClick={() => markPaid(v.id)}>Marcar pagado</button> : null}<button className="danger btnMini" type="button" onClick={() => removeVisit(visitRow)}>Eliminar</button></div><strong>{money(v.amountCollected)}</strong></div></li>; })}</ul></section>}

      {!loading && tab === "products" && <section className="stack"><article className="panel"><h3>Productos</h3><ul className="simple-list">{(data.products || []).map((p) => <li key={p.id}><span>{p.name}</span><strong>{money(p.unitPrice)}</strong></li>)}</ul></article><article className="panel form-panel"><h3>Nuevo producto</h3><form className="form" onSubmit={saveProduct}><label>Nombre<input required value={productForm.name} onChange={(e) => setProductForm((d) => ({ ...d, name: e.target.value }))} /></label><label>Valor unitario<input type="number" min="0" step="0.01" value={productForm.unitPrice} onChange={(e) => setProductForm((d) => ({ ...d, unitPrice: e.target.value }))} /></label><button className="primary full" type="submit">Guardar producto</button></form></article></section>}

      {!loading && tab === "inventory" && <section className="stack"><article className="panel"><h3>Inventario</h3><ul className="simple-list">{(data.inventory || []).map((i) => <li key={i.id}><div><span>{i.productName}</span><small>Cantidad actual: {num(i.quantity).toFixed(2)} unid</small></div><div className="rowEdit"><input className="inlineQty" type="number" min="0" step="0.01" value={inventoryDraft[i.id] ?? i.quantity} onChange={(e) => setInventoryDraft((d) => ({ ...d, [i.id]: e.target.value }))} /><button className="secondary btnMini" type="button" onClick={() => saveInventoryRow(i)}>Editar</button></div></li>)}</ul></article><article className="panel form-panel"><h3>Cargar inventario</h3><form className="form" onSubmit={saveInventory}><label>Producto<select value={inventoryForm.productId} onChange={(e) => setInventoryForm((d) => ({ ...d, productId: e.target.value }))}><option value="">Selecciona producto</option>{(data.products || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Cantidad<input type="number" min="0" step="0.01" value={inventoryForm.quantity} onChange={(e) => setInventoryForm((d) => ({ ...d, quantity: e.target.value }))} /></label><button className="primary full" type="submit">Guardar inventario</button></form></article><article className="panel form-panel"><h3>Transferir a vendedor</h3><form className="form" onSubmit={transferInventory}><label>Vendedor<select value={transferForm.sellerId} onChange={(e) => setTransferForm((d) => ({ ...d, sellerId: e.target.value }))}><option value="">Selecciona vendedor</option>{(data.sellers || []).filter((s) => s.role === "seller" && s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label>Producto<select value={transferForm.productId} onChange={(e) => setTransferForm((d) => ({ ...d, productId: e.target.value }))}><option value="">Selecciona producto</option>{(data.products || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Cantidad<input type="number" min="0" step="0.01" value={transferForm.quantity} onChange={(e) => setTransferForm((d) => ({ ...d, quantity: e.target.value }))} /></label><button className="secondary full" type="submit">Transferir</button></form></article></section>}

      {!loading && tab === "sellers" && <section className="panel"><h3>Vendedores</h3><ul className="simple-list">{(data.sellerOverview || []).map((s) => <li key={s.sellerId}><div><span>{s.sellerName}</span><small>Clientes: {s.totalClients} | Deuda: {money(s.totalDebt)}</small><small>Semana: {money(s.weekSales)} | Mes: {money(s.monthSales)}</small></div><strong>Comision: {money(s.commissionAmount)}</strong></li>)}</ul></section>}

      {!loading && tab === "reports" && <section className="panel"><h3>Reportes y Respaldo</h3><a href={reportUrl} target="_blank" rel="noreferrer" className="primary full fakeBtn">Descargar reporte XLSX</a><div className="miniActions"><button className="secondary btnMini" type="button" onClick={createServerBackup} disabled={backupBusy}>{backupBusy ? "Creando..." : "Crear backup servidor"}</button><a href={dbExportUrl} target="_blank" rel="noreferrer" className="btnMini fakeBtn">Exportar JSON</a></div><p className="preview">Incluye admin y vendedores (misma base de datos).</p>{lastBackupFile ? <p className="preview">Ultimo backup: {lastBackupFile}</p> : null}</section>}

      {tab === "newVisit" && <section className="panel form-panel"><h3>Nueva visita</h3><form className="form" onSubmit={saveVisit}><label>Fecha<input type="date" value={visitForm.date} onChange={(e) => setVisitForm((d) => ({ ...d, date: e.target.value }))} /></label><label>Cliente<select value={visitForm.clientId} onChange={(e) => setVisitForm((d) => ({ ...d, clientId: e.target.value }))}><option value="">Selecciona cliente</option>{(data.clients || []).map((c) => <option key={c.id} value={c.id}>{c.tradeName || c.name}</option>)}</select></label><label>Producto<select value={visitForm.productId} onChange={(e) => { const p = data.products.find((x) => x.id === e.target.value); setVisitForm((d) => ({ ...d, productId: e.target.value, unitPrice: d.unitPrice || String(num(p?.unitPrice)) })); }}><option value="">Selecciona producto</option>{(data.products || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Cantidad<input type="number" min="0" step="0.01" value={visitForm.quantity} onChange={(e) => setVisitForm((d) => ({ ...d, quantity: e.target.value }))} /></label><label>Valor unitario<input type="number" min="0" step="0.01" value={visitForm.unitPrice} onChange={(e) => setVisitForm((d) => ({ ...d, unitPrice: e.target.value }))} /></label><label>Restante en cliente<input type="number" min="0" step="0.01" value={visitForm.remaining} onChange={(e) => setVisitForm((d) => ({ ...d, remaining: e.target.value }))} /></label><label>Monto cobrado<input type="number" min="0" step="0.01" value={visitForm.amountCollected} onChange={(e) => setVisitForm((d) => ({ ...d, amountCollected: e.target.value }))} /></label><label>Tipo venta<select value={visitForm.saleType} onChange={(e) => setVisitForm((d) => ({ ...d, saleType: e.target.value }))}><option value="consignado">Consignado</option><option value="a_vista">A vista</option><option value="boleto">Boleto</option></select></label><label>Proxima visita<input type="date" value={visitForm.nextVisitDate} onChange={(e) => setVisitForm((d) => ({ ...d, nextVisitDate: e.target.value }))} /></label><label>Notas<textarea rows="3" value={visitForm.notes} onChange={(e) => setVisitForm((d) => ({ ...d, notes: e.target.value }))} /></label><button className="primary full" type="submit">Guardar visita</button></form></section>}
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
