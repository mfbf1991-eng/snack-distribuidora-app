import React from "react";

const API_BASE = (import.meta.env.VITE_API_URL || "http://localhost:4000/api").replace(/\/$/, "");

function parseNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatCurrency(amount) {
  return new Intl.NumberFormat("es-VE", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(amount || 0);
}

function formatDate(dateValue) {
  if (!dateValue) return "Sin fecha";
  return new Date(`${dateValue}T00:00:00`).toLocaleDateString("es-VE", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
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

async function apiGet(path) {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) throw new Error("Error al cargar datos del servidor");
  return response.json();
}

async function apiPost(path, payload) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const json = await response.json();
  if (!response.ok) throw new Error(json.error || "Error al guardar");
  return json;
}

function App() {
  const [activeTab, setActiveTab] = React.useState("dashboard");
  const [data, setData] = React.useState({ clients: [], visits: [], dashboard: { totalSoldThisWeek: 0, totalDebt: 0, clientsNeedingVisit: [], topClients: [] } });
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  const [clientForm, setClientForm] = React.useState({
    name: "",
    location: "",
    type: "bodega",
    contact: ""
  });

  const [visitForm, setVisitForm] = React.useState({
    date: new Date().toISOString().slice(0, 10),
    clientId: "",
    delivered: "",
    remaining: "",
    amountCollected: "",
    paymentType: "consignado",
    nextVisitDate: "",
    notes: ""
  });

  async function loadAll() {
    try {
      setLoading(true);
      setError("");
      const payload = await apiGet("/data");
      setData(payload);
    } catch (err) {
      setError(err.message || "No se pudo conectar al servidor local");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    loadAll();
  }, []);

  const selectedClient = data.clients.find((client) => client.id === visitForm.clientId) || null;
  const selectedClientVisits = selectedClient ? getClientVisits(data.visits, selectedClient.id) : [];
  const soldPreview = selectedClient
    ? calculateSold(selectedClientVisits, parseNumber(visitForm.remaining), parseNumber(visitForm.delivered))
    : 0;

  async function handleAddClient(event) {
    event.preventDefault();
    if (!clientForm.name.trim()) return;

    try {
      await apiPost("/clients", clientForm);
      await loadAll();
      setClientForm({ name: "", location: "", type: "bodega", contact: "" });
      setActiveTab("clients");
    } catch (err) {
      setError(err.message || "No se pudo crear el cliente");
    }
  }

  async function handleAddVisit(event) {
    event.preventDefault();
    if (!visitForm.clientId || !visitForm.date) return;

    try {
      await apiPost("/visits", {
        ...visitForm,
        delivered: parseNumber(visitForm.delivered),
        remaining: parseNumber(visitForm.remaining),
        amountCollected: parseNumber(visitForm.amountCollected)
      });

      await loadAll();
      setVisitForm({
        date: new Date().toISOString().slice(0, 10),
        clientId: "",
        delivered: "",
        remaining: "",
        amountCollected: "",
        paymentType: "consignado",
        nextVisitDate: "",
        notes: ""
      });
      setActiveTab("visits");
    } catch (err) {
      setError(err.message || "No se pudo guardar la visita");
    }
  }

  return (
    <main className="app-shell">
      <header className="hero">
        <p>Control de Distribuidora</p>
        <h1>Ventas de Platanitos</h1>
        <div className="actions">
          <button className="primary" type="button" onClick={() => setActiveTab("newVisit")}>Agregar visita</button>
          <button className="secondary" type="button" onClick={() => setActiveTab("newClient")}>Agregar cliente</button>
        </div>
      </header>

      <nav className="tabs">
        <button type="button" className={activeTab === "dashboard" ? "active" : ""} onClick={() => setActiveTab("dashboard")}>Panel</button>
        <button type="button" className={activeTab === "clients" ? "active" : ""} onClick={() => setActiveTab("clients")}>Clientes</button>
        <button type="button" className={activeTab === "visits" ? "active" : ""} onClick={() => setActiveTab("visits")}>Visitas</button>
      </nav>

      {error ? <section className="panel"><p className="empty">{error}</p></section> : null}
      {loading ? <section className="panel"><p className="empty">Cargando...</p></section> : null}

      {!loading && activeTab === "dashboard" && (
        <section className="stack">
          <div className="cards-grid">
            <article className="stat-card warm"><span>Vendido esta semana</span><strong>{data.dashboard.totalSoldThisWeek} bolsas</strong></article>
            <article className="stat-card cool"><span>Deuda total</span><strong>{formatCurrency(data.dashboard.totalDebt)}</strong></article>
            <article className="stat-card mint"><span>Clientes por visitar</span><strong>{data.dashboard.clientsNeedingVisit.length}</strong></article>
          </div>
          <article className="panel">
            <h3>Clientes con mayores ventas</h3>
            {data.dashboard.topClients.length === 0 ? <p className="empty">Aun no hay ventas registradas.</p> : (
              <ul className="simple-list">
                {data.dashboard.topClients.map((item) => (
                  <li key={item.id}><span>{item.name}</span><strong>{item.totalSold} bolsas</strong></li>
                ))}
              </ul>
            )}
          </article>
          <article className="panel">
            <h3>Clientes que necesitan visita</h3>
            {data.dashboard.clientsNeedingVisit.length === 0 ? <p className="empty">Excelente, todos estan al dia.</p> : (
              <ul className="simple-list">
                {data.dashboard.clientsNeedingVisit.map((client) => (
                  <li key={client.id}>
                    <div><span>{client.name}</span><small>{client.location || "Sin ubicacion"}</small></div>
                    <strong>{client.lastVisitDate ? formatDate(client.lastVisitDate) : "Sin visitas"}</strong>
                  </li>
                ))}
              </ul>
            )}
          </article>
        </section>
      )}

      {!loading && activeTab === "clients" && (
        <section className="stack">
          <article className="panel">
            <h3>Lista de clientes</h3>
            {data.clients.length === 0 ? <p className="empty">Agrega tu primer cliente.</p> : (
              <ul className="simple-list clients">
                {data.clients.map((client) => (
                  <li key={client.id}>
                    <div>
                      <span>{client.name}</span>
                      <small>{client.type} | {client.location || "Sin ubicacion"}</small>
                      <small>Ultima visita: {client.lastVisit ? formatDate(client.lastVisit.date) : "Sin registro"}</small>
                      <small>Sugerencia proxima entrega: {client.suggestedDelivery} bolsas</small>
                    </div>
                    <strong>{formatCurrency(client.debt)}</strong>
                  </li>
                ))}
              </ul>
            )}
          </article>
        </section>
      )}

      {!loading && activeTab === "visits" && (
        <section className="stack">
          <article className="panel">
            <h3>Historial de visitas</h3>
            {data.visits.length === 0 ? <p className="empty">No hay visitas registradas.</p> : (
              <ul className="simple-list visits">
                {[...data.visits].sort((a, b) => new Date(b.date) - new Date(a.date)).map((visit) => {
                  const client = data.clients.find((item) => item.id === visit.clientId);
                  return (
                    <li key={visit.id}>
                      <div>
                        <span>{client?.name || "Cliente eliminado"}</span>
                        <small>{formatDate(visit.date)} | {visit.paymentType}</small>
                        <small>Entregado: {visit.delivered} | Restante: {visit.remaining} | Vendido: {visit.soldAmount}</small>
                        {visit.notes ? <small>Nota: {visit.notes}</small> : null}
                      </div>
                      <strong>{formatCurrency(visit.amountCollected)}</strong>
                    </li>
                  );
                })}
              </ul>
            )}
          </article>
        </section>
      )}

      {activeTab === "newClient" && (
        <section className="panel form-panel">
          <h3>Nuevo cliente</h3>
          <form className="form" onSubmit={handleAddClient}>
            <label>Nombre<input required value={clientForm.name} onChange={(event) => setClientForm((prev) => ({ ...prev, name: event.target.value }))} /></label>
            <label>Ubicacion<input value={clientForm.location} onChange={(event) => setClientForm((prev) => ({ ...prev, location: event.target.value }))} /></label>
            <label>Tipo de cliente
              <select value={clientForm.type} onChange={(event) => setClientForm((prev) => ({ ...prev, type: event.target.value }))}>
                <option value="bodega">Bodega</option><option value="kiosco">Kiosco</option><option value="tienda">Tienda</option><option value="otro">Otro</option>
              </select>
            </label>
            <label>Contacto<input value={clientForm.contact} onChange={(event) => setClientForm((prev) => ({ ...prev, contact: event.target.value }))} /></label>
            <button className="primary full" type="submit">Guardar cliente</button>
          </form>
        </section>
      )}

      {activeTab === "newVisit" && (
        <section className="panel form-panel">
          <h3>Nueva visita</h3>
          <form className="form" onSubmit={handleAddVisit}>
            <label>Fecha<input type="date" required value={visitForm.date} onChange={(event) => setVisitForm((prev) => ({ ...prev, date: event.target.value }))} /></label>
            <label>Cliente
              <select required value={visitForm.clientId} onChange={(event) => setVisitForm((prev) => ({ ...prev, clientId: event.target.value }))}>
                <option value="">Selecciona un cliente</option>
                {data.clients.map((client) => (<option key={client.id} value={client.id}>{client.name}</option>))}
              </select>
            </label>
            <label>Cantidad entregada (hoy)<input type="number" min="0" value={visitForm.delivered} onChange={(event) => setVisitForm((prev) => ({ ...prev, delivered: event.target.value }))} /></label>
            <label>Cantidad restante<input type="number" min="0" required value={visitForm.remaining} onChange={(event) => setVisitForm((prev) => ({ ...prev, remaining: event.target.value }))} /></label>
            <label>Cantidad recaudada<input type="number" min="0" step="0.01" required value={visitForm.amountCollected} onChange={(event) => setVisitForm((prev) => ({ ...prev, amountCollected: event.target.value }))} /></label>
            <label>Tipo de pago
              <select value={visitForm.paymentType} onChange={(event) => setVisitForm((prev) => ({ ...prev, paymentType: event.target.value }))}>
                <option value="consignado">Consignado</option>
                <option value="contado">Pago de contado</option>
              </select>
            </label>
            <label>Proxima visita<input type="date" value={visitForm.nextVisitDate} onChange={(event) => setVisitForm((prev) => ({ ...prev, nextVisitDate: event.target.value }))} /></label>
            <label>Notas<textarea rows="3" value={visitForm.notes} onChange={(event) => setVisitForm((prev) => ({ ...prev, notes: event.target.value }))} /></label>
            <p className="preview">Cantidad vendida calculada: <strong>{soldPreview}</strong></p>
            <button className="primary full" type="submit">Guardar visita</button>
          </form>
        </section>
      )}
    </main>
  );
}

export default App;
