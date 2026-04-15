import React from "react";
import logoPlatanito from "./assets/logo-platanito.jpg";

const API_BASE = (import.meta.env.VITE_API_URL || "http://localhost:4000/api").replace(/\/$/, "");
const tabs = [["dashboard", "Panel"],["clients", "Clientes"],["visits", "Visitas"],["products", "Productos"],["inventory", "Inventario"],["sellers", "Vendedores"],["reports", "Reportes"]];

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const money = (v) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(num(v));
const date = (v) => (v ? new Date(`${v}T00:00:00`).toLocaleDateString("pt-BR") : "-");

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

export default function App() {
  const [tab, setTab] = React.useState("dashboard");
  const [data, setData] = React.useState({ clients: [], visits: [], products: [], inventory: [], sellers: [], sellerOverview: [], dashboard: { totalSoldThisWeek: 0, totalDebt: 0, clientsNeedingVisit: [], topClients: [] } });
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [ok, setOk] = React.useState("");

  const [clientForm, setClientForm] = React.useState({ tradeName: "", buyerName: "", location: "", type: "bodega", phone: "", email: "", managedByType: "owner", managedBySellerId: "" });
  const [visitForm, setVisitForm] = React.useState({ date: new Date().toISOString().slice(0, 10), clientId: "", saleType: "consignado", amountCollected: "0", nextVisitDate: "", notes: "", productId: "", quantity: "", unitPrice: "", remaining: "" });
  const [productForm, setProductForm] = React.useState({ name: "", unitPrice: "" });
  const [inventoryForm, setInventoryForm] = React.useState({ productId: "", quantity: "" });
  const [inventoryDraft, setInventoryDraft] = React.useState({});
  const [transferForm, setTransferForm] = React.useState({ sellerId: "", productId: "", quantity: "" });

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

  async function saveClient(e) {
    e.preventDefault();
    if (!clientForm.tradeName.trim()) return setError("Nombre comercio obligatorio");
    try {
      await apiPost("/clients", clientForm);
      setClientForm({ tradeName: "", buyerName: "", location: "", type: "bodega", phone: "", email: "", managedByType: "owner", managedBySellerId: "" });
      setOk("Cliente guardado");
      await loadAll();
      setTab("clients");
    } catch (err) { setError(err.message || "Error"); }
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

  const reportUrl = `${API_BASE}/reports/export-xlsx`;

  return (
    <main className="app-shell">
      <header className="hero">
        <div className="heroTop">
          <img src={logoPlatanito} alt="Logo" className="heroLogo" />
          <div><p>Control de Distribuidora</p><h1>Snack App Admin</h1></div>
        </div>
        <div className="actions"><button className="primary" type="button" onClick={() => setTab("newVisit")}>Agregar visita</button><button className="secondary" type="button" onClick={() => setTab("newClient")}>Agregar cliente</button></div>
      </header>

      <nav className="tabs">{tabs.map(([id, label]) => <button key={id} type="button" className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>)}</nav>

      {error ? <section className="panel"><p className="empty">{error}</p></section> : null}
      {ok ? <section className="panel"><p className="ok">{ok}</p></section> : null}
      {loading ? <section className="panel"><p className="empty">Cargando...</p></section> : null}

      {!loading && tab === "dashboard" && <section className="stack"><div className="cards-grid"><article className="stat-card warm"><span>Vendido esta semana</span><strong>{num(data.dashboard.totalSoldThisWeek).toFixed(2)} unid</strong></article><article className="stat-card cool"><span>Deuda total</span><strong>{money(data.dashboard.totalDebt)}</strong></article><article className="stat-card mint"><span>Clientes por visitar</span><strong>{(data.dashboard.clientsNeedingVisit || []).length}</strong></article></div><article className="panel"><h3>Clientes con mayores ventas</h3><ul className="simple-list">{(data.dashboard.topClients || []).map((c) => <li key={c.id}><span>{c.name}</span><strong>{num(c.totalSold).toFixed(2)} unid</strong></li>)}</ul></article></section>}

      {!loading && tab === "clients" && <section className="panel"><h3>Clientes</h3><ul className="simple-list">{(data.clients || []).map((c) => <li key={c.id}><div><span>{c.tradeName || c.name}</span><small>{c.type} | {c.location || "Sin ubicacion"}</small><small>Responsable: {c.buyerName || c.contact || "-"}</small></div><strong>{money(c.debt)}</strong></li>)}</ul></section>}

      {!loading && tab === "visits" && <section className="panel"><h3>Visitas</h3><ul className="simple-list">{[...(data.visits || [])].sort((a, b) => new Date(b.date) - new Date(a.date)).map((v) => { const c = data.clients.find((x) => x.id === v.clientId); const boleto = String(v.saleType || "").toLowerCase() === "boleto" && !v.boletoPaid; return <li key={v.id}><div><span>{c?.tradeName || c?.name || "Cliente"}</span><small>{date(v.date)} | {v.saleType || v.paymentType}</small><small>Total: {money(v.totalValue ?? v.soldAmount)} | Cobrado: {money(v.amountCollected)}</small></div><div className="rightCol">{boleto ? <button className="secondary btnMini" type="button" onClick={() => markPaid(v.id)}>Marcar pagado</button> : null}<strong>{money(v.amountCollected)}</strong></div></li>; })}</ul></section>}

      {!loading && tab === "products" && <section className="stack"><article className="panel"><h3>Productos</h3><ul className="simple-list">{(data.products || []).map((p) => <li key={p.id}><span>{p.name}</span><strong>{money(p.unitPrice)}</strong></li>)}</ul></article><article className="panel form-panel"><h3>Nuevo producto</h3><form className="form" onSubmit={saveProduct}><label>Nombre<input required value={productForm.name} onChange={(e) => setProductForm((d) => ({ ...d, name: e.target.value }))} /></label><label>Valor unitario<input type="number" min="0" step="0.01" value={productForm.unitPrice} onChange={(e) => setProductForm((d) => ({ ...d, unitPrice: e.target.value }))} /></label><button className="primary full" type="submit">Guardar producto</button></form></article></section>}

      {!loading && tab === "inventory" && <section className="stack"><article className="panel"><h3>Inventario</h3><ul className="simple-list">{(data.inventory || []).map((i) => <li key={i.id}><div><span>{i.productName}</span><small>Cantidad actual: {num(i.quantity).toFixed(2)} unid</small></div><div className="rowEdit"><input className="inlineQty" type="number" min="0" step="0.01" value={inventoryDraft[i.id] ?? i.quantity} onChange={(e) => setInventoryDraft((d) => ({ ...d, [i.id]: e.target.value }))} /><button className="secondary btnMini" type="button" onClick={() => saveInventoryRow(i)}>Editar</button></div></li>)}</ul></article><article className="panel form-panel"><h3>Cargar inventario</h3><form className="form" onSubmit={saveInventory}><label>Producto<select value={inventoryForm.productId} onChange={(e) => setInventoryForm((d) => ({ ...d, productId: e.target.value }))}><option value="">Selecciona producto</option>{(data.products || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Cantidad<input type="number" min="0" step="0.01" value={inventoryForm.quantity} onChange={(e) => setInventoryForm((d) => ({ ...d, quantity: e.target.value }))} /></label><button className="primary full" type="submit">Guardar inventario</button></form></article><article className="panel form-panel"><h3>Transferir a vendedor</h3><form className="form" onSubmit={transferInventory}><label>Vendedor<select value={transferForm.sellerId} onChange={(e) => setTransferForm((d) => ({ ...d, sellerId: e.target.value }))}><option value="">Selecciona vendedor</option>{(data.sellers || []).filter((s) => s.role === "seller" && s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label>Producto<select value={transferForm.productId} onChange={(e) => setTransferForm((d) => ({ ...d, productId: e.target.value }))}><option value="">Selecciona producto</option>{(data.products || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Cantidad<input type="number" min="0" step="0.01" value={transferForm.quantity} onChange={(e) => setTransferForm((d) => ({ ...d, quantity: e.target.value }))} /></label><button className="secondary full" type="submit">Transferir</button></form></article></section>}

      {!loading && tab === "sellers" && <section className="panel"><h3>Vendedores</h3><ul className="simple-list">{(data.sellerOverview || []).map((s) => <li key={s.sellerId}><div><span>{s.sellerName}</span><small>Clientes: {s.totalClients} | Deuda: {money(s.totalDebt)}</small><small>Semana: {money(s.weekSales)} | Mes: {money(s.monthSales)}</small></div><strong>Comision: {money(s.commissionAmount)}</strong></li>)}</ul></section>}

      {!loading && tab === "reports" && <section className="panel"><h3>Reportes</h3><a href={reportUrl} target="_blank" rel="noreferrer" className="primary full fakeBtn">Descargar reporte XLSX</a></section>}

      {tab === "newClient" && <section className="panel form-panel"><h3>Nuevo cliente</h3><form className="form" onSubmit={saveClient}><label>Nombre comercio<input required value={clientForm.tradeName} onChange={(e) => setClientForm((d) => ({ ...d, tradeName: e.target.value }))} /></label><label>Responsable<input value={clientForm.buyerName} onChange={(e) => setClientForm((d) => ({ ...d, buyerName: e.target.value }))} /></label><label>Ubicacion<input value={clientForm.location} onChange={(e) => setClientForm((d) => ({ ...d, location: e.target.value }))} /></label><label>Tipo<input value={clientForm.type} onChange={(e) => setClientForm((d) => ({ ...d, type: e.target.value }))} /></label><label>Telefono<input value={clientForm.phone} onChange={(e) => setClientForm((d) => ({ ...d, phone: e.target.value }))} /></label><button className="primary full" type="submit">Guardar cliente</button></form></section>}

      {tab === "newVisit" && <section className="panel form-panel"><h3>Nueva visita</h3><form className="form" onSubmit={saveVisit}><label>Fecha<input type="date" value={visitForm.date} onChange={(e) => setVisitForm((d) => ({ ...d, date: e.target.value }))} /></label><label>Cliente<select value={visitForm.clientId} onChange={(e) => setVisitForm((d) => ({ ...d, clientId: e.target.value }))}><option value="">Selecciona cliente</option>{(data.clients || []).map((c) => <option key={c.id} value={c.id}>{c.tradeName || c.name}</option>)}</select></label><label>Producto<select value={visitForm.productId} onChange={(e) => { const p = data.products.find((x) => x.id === e.target.value); setVisitForm((d) => ({ ...d, productId: e.target.value, unitPrice: d.unitPrice || String(num(p?.unitPrice)) })); }}><option value="">Selecciona producto</option>{(data.products || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Cantidad<input type="number" min="0" step="0.01" value={visitForm.quantity} onChange={(e) => setVisitForm((d) => ({ ...d, quantity: e.target.value }))} /></label><label>Valor unitario<input type="number" min="0" step="0.01" value={visitForm.unitPrice} onChange={(e) => setVisitForm((d) => ({ ...d, unitPrice: e.target.value }))} /></label><label>Restante en cliente<input type="number" min="0" step="0.01" value={visitForm.remaining} onChange={(e) => setVisitForm((d) => ({ ...d, remaining: e.target.value }))} /></label><label>Monto cobrado<input type="number" min="0" step="0.01" value={visitForm.amountCollected} onChange={(e) => setVisitForm((d) => ({ ...d, amountCollected: e.target.value }))} /></label><label>Tipo venta<select value={visitForm.saleType} onChange={(e) => setVisitForm((d) => ({ ...d, saleType: e.target.value }))}><option value="consignado">Consignado</option><option value="a_vista">A vista</option><option value="boleto">Boleto</option></select></label><label>Proxima visita<input type="date" value={visitForm.nextVisitDate} onChange={(e) => setVisitForm((d) => ({ ...d, nextVisitDate: e.target.value }))} /></label><label>Notas<textarea rows="3" value={visitForm.notes} onChange={(e) => setVisitForm((d) => ({ ...d, notes: e.target.value }))} /></label><button className="primary full" type="submit">Guardar visita</button></form></section>}
    </main>
  );
}
