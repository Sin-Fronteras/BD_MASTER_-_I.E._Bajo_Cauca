
/* script.js - VERSIÓN FINAL (Lógica Completa) */

/* ================= CONFIGURACIÓN ================= */
const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRe5o92LzVVZNSuqn2eUpGf3t1nr_rf58V37ypPjGldYnxNg1B9XTrtZCvNSU-VTKdszHXD9WeqE8sk/pub?gid=1700850446&single=true&output=csv";
const DEBOUNCE_MS = 250;

// Campos para búsqueda en Caja 1
const CAJON1_FIELDS = ["MUNICIPIO", "COD_IE_DANE", "INSTITUCION", "COD_SEDE_DANE", "SEDE", "UBICACION", "ZONA"];

// Columnas especiales para búsqueda en Caja 2 (Proyectos)
const CAJON2_INDEXABLE_HEADERS = [
  "2022 ERA", "2023 Docentes", "2023 Estudiantes", "2024 Docentes", "2024 Estudiantes", "2025 Docentes", "2025 Estudiantes",
  "2022 ESC_VIDA", "2023 ESC_VIDA", "2024 ESC_VIDA", "2025 ESC_VIDA", "2024 NIDO", "2025 NIDO", "BATUTA 2025", "ATAL 2025", "FCC 2025", "PASC 2025",
  "MAMM 2025", "BECA UDEA 2025", "PC 2023", "PC 2024", "Bibliográfica (Dotación)", "Deportiva (Dotación)", "INFRAEST. Gob",
  "Legalización Predio Resolución de sana posesión", "Bienestar Maestro", "SENA (Oferta)", "COMFAMA inspiración", "AGUA (Alianza por el Agua)",
  "Agua Fund.EPM", "Agua potable", "Conectividad", "Embellecimiento Escuelas"
];

/* ================ VARIABLES DE ESTADO ================ */
let rawRows = [];
let headerRow = []; // Guardará { visible: "Nombre Original", key: "NOMBRE_LIMPIO" }
let rows = []; 
let filtered = [];
let queryCacheLocal = new Map();
let queryCacheCat = new Map();
let showTable = false; 
let activeCategoryHeaders = []; 

/* ================ UTILIDADES ================ */
function safeText(x) { return x === undefined || x === null ? '' : String(x); }
function fixEncoding(s) { try { return decodeURIComponent(escape(s)); } catch (e) { return s; } }

// Normaliza para CREAR CLAVES (Búsqueda interna), pero no altera la visualización original
function normalizeKey(raw) {
  const fixed = fixEncoding(safeText(raw)).replace(/[\u0000-\u001F]/g, '').trim();
  const noAccents = fixed.normalize('NFD').replace(/\p{Diacritic}/gu, '');
  const key = noAccents.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase().replace(/^_|_$/g, '');
  return { visible: fixed, key: key };
}

// Normaliza para COMPARAR (Búsqueda)
function normalizeForSearch(s) {
  if (s === undefined || s === null) return '';
  return fixEncoding(String(s)).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

function parseNumber(v) {
  if (!v) return 0;
  const s = String(v).replace(/[^\d\-\.\,]/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return isNaN(n) ? 0 : n;
}

/* ================= CARGA DE DATOS ================= */
function loadCSV() {
  document.getElementById('loading').textContent = 'Cargando base de datos...';
  Papa.parse(CSV_URL, {
    download: true, skipEmptyLines: false, complete: function (res) {
      
      // Proceso raw: Eliminar filas vacías finales
      rawRows = res.data.map(r => r.map(c => c === undefined ? '' : String(c)));
      while (rawRows.length && rawRows[rawRows.length - 1].every(x => x.trim() === '')) rawRows.pop();
      
      if (rawRows.length < 3) {
        alert('Error: El archivo CSV no tiene la estructura esperada (mínimo 3 filas).');
        return;
      }

      // LA FILA 3 (Índice 2) ES EL ENCABEZADO REAL
      headerRow = rawRows[2].map(cell => normalizeKey(cell));

      // Procesar datos desde fila 4 (Índice 3)
      rows = rawRows.slice(3).map(r => {
        const obj = {};
        for (let i = 0; i < headerRow.length; i++) {
          // Usamos la KEY limpia para referencia interna, pero guardamos el valor tal cual
          const key = headerRow[i].key || `COL_${i}`;
          obj[key] = safeText(r[i]);
          
          // También guardamos con el nombre original para el Modal
          obj[`__orig_${headerRow[i].visible}`] = safeText(r[i]);
        }

        // Metadatos precalculados para búsqueda rápida
        obj.__meta = {
          full: normalizeForSearch(Object.values(obj).join(' ')),
          mun: normalizeForSearch(obj["MUNICIPIO"]),
          sede: normalizeForSearch(obj["SEDE"]),
          inst: normalizeForSearch(obj["INSTITUCION"]),
          cod: normalizeForSearch(obj["COD_SEDE_DANE"] || obj["COD_IE_DANE"])
        };
        
        // Detectar Total General (variaciones de nombre)
        let totalVal = 0;
        if(obj["TOTAL_GENERAL"]) totalVal = parseNumber(obj["TOTAL_GENERAL"]);
        else if(obj["TOTAL"]) totalVal = parseNumber(obj["TOTAL"]);
        obj.__meta.total = totalVal;

        return obj;
      });

      populateMunicipios();
      filtered = []; 
      resetApp(); // Iniciar en vista Resumen
    }, error: function (err) {
      console.error(err);
      document.getElementById('loading').textContent = 'Error de conexión.';
    }
  });
}

/* ================= UI INIT ================= */
document.addEventListener('DOMContentLoaded', () => {
  loadCSV();
  setupEvents();
});

function setupEvents() {
  const inp1 = document.getElementById('searchLocal');
  const inp2 = document.getElementById('searchCategory');
  const btnHome = document.getElementById('btnHome');
  const btnReset = document.getElementById('clearLocal');
  const btnResetCat = document.getElementById('clearCat');

  let debounceTimer;

  // CAJA 1: SEDES (Limpieza Cruzada)
  inp1.addEventListener('input', (e) => {
    // Si escribo en caja 1, borro caja 2 inmediatamente
    if(inp2.value !== '') { inp2.value = ''; document.getElementById('suggestCat').style.display='none'; }
    
    clearTimeout(debounceTimer);
    const val = e.target.value;
    if(!val) { 
      document.getElementById('suggestLocal').style.display='none'; 
      return; 
    }
    debounceTimer = setTimeout(() => { renderLocalSuggestions(val); }, DEBOUNCE_MS);
  });

  // TECLA ENTER CAJA 1
  inp1.addEventListener('keydown', (e) => {
    if(e.key === 'Enter') {
      e.preventDefault();
      // Seleccionar primer resultado automáticamente
      const list = document.getElementById('suggestLocal');
      if(list.style.display !== 'none' && list.firstChild) {
        list.firstChild.click();
      }
    }
  });

  // CAJA 2: PROYECTOS (Limpieza Cruzada)
  inp2.addEventListener('input', (e) => {
    // Si escribo en caja 2, borro caja 1 inmediatamente
    if(inp1.value !== '') { inp1.value = ''; document.getElementById('suggestLocal').style.display='none'; }

    clearTimeout(debounceTimer);
    const val = e.target.value;
    if(!val) { 
      document.getElementById('suggestCat').style.display='none'; 
      return; 
    }
    debounceTimer = setTimeout(() => { renderCatSuggestions(val); }, DEBOUNCE_MS);
  });

  // TECLA ENTER CAJA 2
  inp2.addEventListener('keydown', (e) => {
    if(e.key === 'Enter') {
      e.preventDefault();
      const list = document.getElementById('suggestCat');
      if(list.style.display !== 'none' && list.firstChild) {
        list.firstChild.click();
      }
    }
  });

  // BOTONES DE LIMPIEZA (X) -> VOLVER A INICIO
  btnReset.addEventListener('click', resetApp);
  btnResetCat.addEventListener('click', resetApp);
  btnHome.addEventListener('click', resetApp);

  // CLICK FUERA CIERRA SUGERENCIAS
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.control-group')) {
      document.getElementById('suggestLocal').style.display='none';
      document.getElementById('suggestCat').style.display='none';
    }
  });

  // FILTROS
  document.getElementById('applyFilters').addEventListener('click', applyFilters);
  document.getElementById('closeModal').addEventListener('click', () => {
    document.getElementById('modalBack').style.display = 'none';
  });
}

/* ================= LÓGICA DE BÚSQUEDA ================= */
function searchCandidatesLocal(q) {
  const qn = normalizeForSearch(q);
  if (qn.length < 2) return [];
  
  // Algoritmo de puntuación
  const res = rows.map(r => {
    let score = 0;
    // Coincidencia exacta inicio tiene prioridad
    if (r.__meta.sede.startsWith(qn)) score += 100;
    else if (r.__meta.sede.includes(qn)) score += 50;
    
    if (r.__meta.inst.startsWith(qn)) score += 80;
    else if (r.__meta.inst.includes(qn)) score += 40;

    if (r.__meta.mun.startsWith(qn)) score += 30;
    if (r.__meta.cod.includes(qn)) score += 60;

    return { row: r, score: score };
  }).filter(x => x.score > 0);

  // Ordenar por score y luego alfabético
  res.sort((a, b) => b.score - a.score);
  return res.slice(0, 50).map(x => x.row); // Top 50
}

function renderLocalSuggestions(q) {
  const list = searchCandidatesLocal(q);
  const el = document.getElementById('suggestLocal');
  el.innerHTML = '';
  
  if(list.length === 0) { el.style.display='none'; return; }
  el.style.display='block';

  list.forEach(r => {
    const div = document.createElement('div');
    div.className = 'suggest-item';
    div.innerHTML = `
      <div class="suggest-line-main">${highlight(r["SEDE"] || r["INSTITUCION"], q)}</div>
      <div class="suggest-line-sub">${r["MUNICIPIO"]} • ${r["COD_SEDE_DANE"] || ''}</div>
    `;
    div.onclick = () => {
      filtered = [r];
      document.getElementById('searchLocal').value = r["SEDE"];
      el.style.display='none';
      activeCategoryHeaders = [];
      showTableMode(`Sede seleccionada: ${r["SEDE"]}`);
    };
    el.appendChild(div);
  });
}

function renderCatSuggestions(q) {
  const qn = normalizeForSearch(q);
  const el = document.getElementById('suggestCat');
  el.innerHTML = '';

  // Buscar coincidencia en los encabezados permitidos
  const matches = CAJON2_INDEXABLE_HEADERS.filter(h => normalizeForSearch(h).includes(qn));
  
  if(matches.length === 0) { el.style.display='none'; return; }
  el.style.display='block';

  matches.forEach(header => {
    // Contar cuantos tienen datos
    const key = normalizeKey(header).key;
    const count = rows.filter(r => r[key] && r[key].trim() !== '').length;
    
    if(count > 0) {
      const div = document.createElement('div');
      div.className = 'suggest-item';
      div.innerHTML = `
        <div class="suggest-line-main">${highlight(header, q)}</div>
        <div class="suggest-line-sub">${count} sedes con este dato</div>
      `;
      div.onclick = () => {
        // Filtrar filas
        filtered = rows.filter(r => r[key] && r[key].trim() !== '');
        activeCategoryHeaders = [key]; // Guardar la KEY para mostrarla
        document.getElementById('searchCategory').value = header;
        el.style.display='none';
        showTableMode(`Categoría: ${header}`);
      };
      el.appendChild(div);
    }
  });
}

/* ================= VISTAS Y TABLA ================= */
function resetApp() {
  document.getElementById('searchLocal').value = '';
  document.getElementById('searchCategory').value = '';
  document.getElementById('suggestLocal').style.display = 'none';
  document.getElementById('suggestCat').style.display = 'none';
  document.getElementById('filterMunicipio').value = '';
  
  filtered = rows; // Todos los datos para estadísticas
  
  // Mostrar Graficos, Ocultar Tabla
  document.getElementById('summaryArea').style.display = 'block';
  document.getElementById('tablaWrapper').style.display = 'none';
  document.getElementById('btnHome').style.display = 'none'; // Ocultar botón Home
  
  document.getElementById('resultsCount').textContent = rows.length;
  document.getElementById('activeFilters').textContent = '';
  
  renderStats();
}

function showTableMode(msg) {
  document.getElementById('summaryArea').style.display = 'none';
  document.getElementById('tablaWrapper').style.display = 'block';
  document.getElementById('btnHome').style.display = 'inline-block'; // Mostrar botón Home
  
  document.getElementById('resultsCount').textContent = filtered.length;
  document.getElementById('activeFilters').textContent = msg;
  
  renderTable();
}

function renderTable() {
  const table = document.getElementById('dataTable');
  table.innerHTML = '';

  const thead = document.createElement('thead');
  const trh = document.createElement('tr');

  // COLUMNAS EXACTAS QUE PEDISTE (5 COLUMNAS)
  // Nota: Buscaremos "ZONA" o "UBICACION" automáticamente
  const desiredCols = ["MUNICIPIO", "INSTITUCION", "SEDE", "ZONA", "TOTAL_GENERAL"];
  
  desiredCols.forEach(colKey => {
    const th = document.createElement('th');
    let text = colKey;
    
    // ENMASCARAMIENTO
    if (colKey === "TOTAL_GENERAL") text = "TOTAL ESTUDIANTES";
    if (colKey === "INSTITUCION") text = "INSTITUCIÓN EDUCATIVA";
    
    th.textContent = text;
    trh.appendChild(th);
  });
  thead.appendChild(trh);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  
  // Limite de renderizado para velocidad
  const pageData = filtered.slice(0, 500);
  
  pageData.forEach(r => {
    const tr = document.createElement('tr');
    tr.onclick = () => openModal(r); // Click en fila abre modal

    desiredCols.forEach(colKey => {
      const td = document.createElement('td');
      let val = "";

      if(colKey === "ZONA") {
        // Lógica especial: Buscar ZONA o UBICACION
        val = r["ZONA"] || r["UBICACION"] || "";
      } 
      else if (colKey === "TOTAL_GENERAL") {
        // Buscar TOTAL GENERAL, TOTAL, etc
        val = r.__meta.total || "0";
      }
      else {
        val = r[colKey] || "";
      }

      td.textContent = val;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
}

/* ================= MODAL ================= */
function openModal(row) {
  const modal = document.getElementById('modalBack');
  const body = document.getElementById('modalBody');
  body.innerHTML = '';
  
  // Creamos una tabla vertical con TODOS los datos originales
  const t = document.createElement('table');
  t.style.width = '100%';
  
  // Recorremos el headerRow original para mostrar nombres reales
  headerRow.forEach(h => {
    // Buscar el valor usando el nombre original guardado
    const originalName = h.visible;
    const val = row[`__orig_${originalName}`];

    if(val && val.trim() !== '') {
      const tr = document.createElement('tr');
      const tdLabel = document.createElement('td');
      tdLabel.style.fontWeight = '700';
      tdLabel.style.width = '40%';
      tdLabel.style.background = '#f9fafb';
      tdLabel.textContent = originalName;

      const tdVal = document.createElement('td');
      tdVal.textContent = val;

      tr.appendChild(tdLabel);
      tr.appendChild(tdVal);
      t.appendChild(tr);
    }
  });

  body.appendChild(t);
  modal.style.display = 'flex';
}

/* ================= FILTROS Y EXTRAS ================= */
function populateMunicipios() {
  const select = document.getElementById('filterMunicipio');
  const muns = new Set(rows.map(r => r["MUNICIPIO"]).filter(x=>x));
  const sorted = Array.from(muns).sort();
  sorted.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    select.appendChild(opt);
  });
}

function applyFilters() {
  const mun = document.getElementById('filterMunicipio').value;
  if(!mun) { resetApp(); return; }
  
  filtered = rows.filter(r => r["MUNICIPIO"] === mun);
  showTableMode(`Municipio: ${mun}`);
}

function highlight(txt, q) {
  if(!txt) return "";
  const i = normalizeForSearch(txt).indexOf(normalizeForSearch(q));
  if(i >= 0) {
    return txt.substring(0, i) + "<strong>" + txt.substring(i, i + q.length) + "</strong>" + txt.substring(i + q.length);
  }
  return txt;
}

/* ================= GRÁFICOS (KPIs) ================= */
let chartInstance = null;
function renderStats() {
  // Calcular KPIs
  const totalEst = rows.reduce((acc, r) => acc + (r.__meta.total || 0), 0);
  document.getElementById('kpiTotal').textContent = new Intl.NumberFormat().format(totalEst);
  document.getElementById('kpiSedes').textContent = new Intl.NumberFormat().format(rows.length);

  // Gráfico Sedes por Municipio
  const counts = {};
  rows.forEach(r => {
    const m = r["MUNICIPIO"] || "Otros";
    counts[m] = (counts[m] || 0) + 1;
  });
  
  const labels = Object.keys(counts).sort();
  const data = labels.map(k => counts[k]);

  const ctx = document.getElementById('chartSedes');
  if(chartInstance) chartInstance.destroy();

  chartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Número de Sedes',
        data: data,
        backgroundColor: '#336699',
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } }
    }
  });
}
