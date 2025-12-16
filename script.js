/* script.js - VERSIÓN MEJORADA 1 */

/* ================= CONFIGURACIÓN ================= */
const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRe5o92LzVVZNSuqn2eUpGf3t1nr_rf58V37ypPjGldYnxNg1B9XTrtZCvNSU-VTKdszHXD9WeqE8sk/pub?gid=1700850446&single=true&output=csv";
const DEBOUNCE_MS = 250;

// Mejora #1: Eliminado "MUNICIPIO" de búsqueda en caja 1 por solicitud
const CAJON1_FIELDS = ["COD_IE_DANE", "INSTITUCION", "COD_SEDE_DANE", "SEDE", "UBICACION", "ZONA"];

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
let headerRow = [];
let rows = []; 
let filtered = [];
let showTable = false; 
let activeCategoryHeaders = []; // Guardará qué columna estamos buscando

/* ================ UTILIDADES ================ */
function safeText(x) { return x === undefined || x === null ? '' : String(x); }
function fixEncoding(s) { try { return decodeURIComponent(escape(s)); } catch (e) { return s; } }

function normalizeKey(raw) {
  const fixed = fixEncoding(safeText(raw)).replace(/[\u0000-\u001F]/g, '').trim();
  const noAccents = fixed.normalize('NFD').replace(/\p{Diacritic}/gu, '');
  const key = noAccents.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase().replace(/^_|_$/g, '');
  return { visible: fixed, key: key };
}

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
      
      rawRows = res.data.map(r => r.map(c => c === undefined ? '' : String(c)));
      while (rawRows.length && rawRows[rawRows.length - 1].every(x => x.trim() === '')) rawRows.pop();
      
      if (rawRows.length < 3) {
        alert('Error: El archivo CSV no tiene la estructura esperada (mínimo 3 filas).');
        return;
      }

      headerRow = rawRows[2].map(cell => normalizeKey(cell));

      rows = rawRows.slice(3).map(r => {
        const obj = {};
        for (let i = 0; i < headerRow.length; i++) {
          const key = headerRow[i].key || `COL_${i}`;
          obj[key] = safeText(r[i]);
          obj[`__orig_${headerRow[i].visible}`] = safeText(r[i]);
        }

        obj.__meta = {
          full: normalizeForSearch(Object.values(obj).join(' ')),
          mun: normalizeForSearch(obj["MUNICIPIO"]),
          sede: normalizeForSearch(obj["SEDE"]),
          inst: normalizeForSearch(obj["INSTITUCION"]),
          cod: normalizeForSearch(obj["COD_SEDE_DANE"] || obj["COD_IE_DANE"]),
          zona: normalizeForSearch(obj["ZONA"] || obj["UBICACION"] || "") // Para filtro rural/urbano
        };

        // Detectar Total Estudiantes (TOTAL_GENERAL)
        let totalVal = 0;
        if(obj["TOTAL_GENERAL"]) totalVal = parseNumber(obj["TOTAL_GENERAL"]);
        else if(obj["TOTAL"]) totalVal = parseNumber(obj["TOTAL"]);
        obj.__meta.totalEst = totalVal;

        // Mejora #2: Detectar Total Docentes (Usamos 2025 como base por defecto)
        let docVal = 0;
        if(obj["2025_DOCENTES"]) docVal = parseNumber(obj["2025_DOCENTES"]);
        else if(obj["2024_DOCENTES"]) docVal = parseNumber(obj["2024_DOCENTES"]); // Fallback
        obj.__meta.totalDoc = docVal;

        return obj;
      });

      populateMunicipios();
      filtered = []; 
      resetApp();
    }, error: function (err) {
      console.error(err);
      document.getElementById('loading').textContent = 'Error de conexión.';
    }
  });
}

/* ================= UI INIT ================= */
document.addEventListener('DOMContentLoaded', () => {
  // Configuración global de ChartDataLabels para color y fuente
  Chart.defaults.set('plugins.datalabels', {
    color: '#333',
    font: { weight: 'bold', size: 11 },
    anchor: 'end',
    align: 'top',
    offset: -2
  });
  
  loadCSV();
  setupEvents();
});

function setupEvents() {
  const inp1 = document.getElementById('searchLocal');
  const inp2 = document.getElementById('searchCategory');
  const btnHome = document.getElementById('btnHome');
  const btnReset = document.getElementById('clearLocal');
  const btnResetCat = document.getElementById('clearCat');
  // Mejora #9: Evento directo en el select
  const selectMun = document.getElementById('filterMunicipio');

  let debounceTimer;

  // CAJA 1
  inp1.addEventListener('input', (e) => {
    if(inp2.value !== '') { inp2.value = ''; document.getElementById('suggestCat').style.display='none'; }
    clearTimeout(debounceTimer);
    const val = e.target.value;
    if(!val) { document.getElementById('suggestLocal').style.display='none'; return; }
    debounceTimer = setTimeout(() => { renderLocalSuggestions(val); }, DEBOUNCE_MS);
  });
  inp1.addEventListener('keydown', (e) => {
    if(e.key === 'Enter') {
      e.preventDefault();
      const list = document.getElementById('suggestLocal');
      if(list.style.display !== 'none' && list.firstChild) list.firstChild.click();
    }
  });

  // CAJA 2
  inp2.addEventListener('input', (e) => {
    if(inp1.value !== '') { inp1.value = ''; document.getElementById('suggestLocal').style.display='none'; }
    clearTimeout(debounceTimer);
    const val = e.target.value;
    if(!val) { document.getElementById('suggestCat').style.display='none'; return; }
    debounceTimer = setTimeout(() => { renderCatSuggestions(val); }, DEBOUNCE_MS);
  });
  inp2.addEventListener('keydown', (e) => {
    if(e.key === 'Enter') {
      e.preventDefault();
      const list = document.getElementById('suggestCat');
      if(list.style.display !== 'none' && list.firstChild) list.firstChild.click();
    }
  });

  btnReset.addEventListener('click', resetApp);
  btnResetCat.addEventListener('click', resetApp);
  btnHome.addEventListener('click', resetApp);

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.control-group')) {
      document.getElementById('suggestLocal').style.display='none';
      document.getElementById('suggestCat').style.display='none';
    }
  });

  // Mejora #9: Filtro inmediato al cambiar municipio
  selectMun.addEventListener('change', () => {
      applyFilters();
  });

  document.getElementById('closeModal').addEventListener('click', () => {
    document.getElementById('modalBack').style.display = 'none';
  });
}

/* ================= LÓGICA DE BÚSQUEDA ================= */
function searchCandidatesLocal(q) {
  const qn = normalizeForSearch(q);
  if (qn.length < 2) return [];

  const res = rows.map(r => {
    let score = 0;
    if (r.__meta.sede.startsWith(qn)) score += 100;
    else if (r.__meta.sede.includes(qn)) score += 50;
    
    if (r.__meta.inst.startsWith(qn)) score += 80;
    else if (r.__meta.inst.includes(qn)) score += 40;

    // MUNICIPIO removido de búsqueda principal según requerimiento, pero se mantiene indexado
    if (r.__meta.cod.includes(qn)) score += 60;

    return { row: r, score: score };
  }).filter(x => x.score > 0);

  res.sort((a, b) => b.score - a.score);
  return res.slice(0, 50).map(x => x.row);
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

  const matches = CAJON2_INDEXABLE_HEADERS.filter(h => normalizeForSearch(h).includes(qn));
  if(matches.length === 0) { el.style.display='none'; return; }
  el.style.display='block';

  matches.forEach(header => {
    const key = normalizeKey(header).key;
    // Contar cuantos tienen datos (no vacío, no cero, no 'NO')
    const count = rows.filter(r => {
        const val = r[key];
        return val && val.trim() !== '' && val.trim() !== '0' && val.toUpperCase() !== 'NO';
    }).length;
    
    if(count > 0) {
      const div = document.createElement('div');
      div.className = 'suggest-item';
      div.innerHTML = `
        <div class="suggest-line-main">${highlight(header, q)}</div>
        <div class="suggest-line-sub">${count} sedes con este proyecto</div>
      `;
      div.onclick = () => {
        filtered = rows.filter(r => {
             const val = r[key];
             return val && val.trim() !== '' && val.trim() !== '0' && val.toUpperCase() !== 'NO';
        });
        // Mejora #8: Guardar columna para mostrarla en tabla
        activeCategoryHeaders = [key]; 
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
  
  filtered = rows; // Todos los datos
  
  document.getElementById('summaryArea').style.display = 'block';
  document.getElementById('tablaWrapper').style.display = 'none';
  document.getElementById('btnHome').style.display = 'none';
  
  document.getElementById('resultsCount').textContent = rows.length;
  document.getElementById('resultsSums').textContent = ''; // Limpiar sumas
  document.getElementById('activeFilters').textContent = '';
  
  renderStats();
}

function showTableMode(msg) {
  document.getElementById('summaryArea').style.display = 'none';
  document.getElementById('tablaWrapper').style.display = 'block';
  document.getElementById('btnHome').style.display = 'inline-block';
  
  document.getElementById('resultsCount').textContent = filtered.length;
  
  // Mejora #5: Calcular sumas de Estudiantes y Docentes de los resultados filtrados
  const sumEst = filtered.reduce((acc, r) => acc + (r.__meta.totalEst || 0), 0);
  const sumDoc = filtered.reduce((acc, r) => acc + (r.__meta.totalDoc || 0), 0);
  
  document.getElementById('resultsSums').textContent = 
    `(Estudiantes: ${new Intl.NumberFormat().format(sumEst)} | Docentes: ${new Intl.NumberFormat().format(sumDoc)})`;
  
  document.getElementById('activeFilters').textContent = msg;
  
  renderTable();
}

function renderTable() {
  const table = document.getElementById('dataTable');
  table.innerHTML = '';

  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  
  // Columnas base
  let desiredCols = ["MUNICIPIO", "INSTITUCION", "SEDE", "ZONA", "TOTAL_GENERAL"];
  
  // Mejora #8: Si hay búsqueda por categoría, agregar esa columna al final
  if (activeCategoryHeaders.length > 0) {
      desiredCols.push(activeCategoryHeaders[0]);
  }

  desiredCols.forEach(colKey => {
    const th = document.createElement('th');
    let text = colKey;
    
    // Mejora #4: Renombrar header y centrar
    if (colKey === "TOTAL_GENERAL") text = "Estudiantes";
    if (colKey === "INSTITUCION") text = "INSTITUCIÓN EDUCATIVA";
    
    // Si es la columna extra dinámica, buscar su nombre original visible
    if (activeCategoryHeaders.includes(colKey)) {
        // Intentar buscar nombre bonito inverso o dejar KEY
        const niceName = headerRow.find(h => h.key === colKey);
        if(niceName) text = niceName.visible;
    }
    
    th.textContent = text;
    // Centrar columna Estudiantes
    if (colKey === "TOTAL_GENERAL") th.classList.add("text-center");
    
    trh.appendChild(th);
  });
  thead.appendChild(trh);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  const pageData = filtered.slice(0, 500); // Limite de renderizado
  
  pageData.forEach(r => {
    const tr = document.createElement('tr');
    tr.onclick = () => openModal(r); 

    desiredCols.forEach(colKey => {
      const td = document.createElement('td');
      let val = "";

      if(colKey === "ZONA") {
        val = r["ZONA"] || r["UBICACION"] || "";
      } 
      else if (colKey === "TOTAL_GENERAL") {
        val = r.__meta.totalEst || "0";
        td.classList.add("text-center"); // Mejora #4: Centrar datos
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
  
  const t = document.createElement('table');
  t.style.width = '100%';

  headerRow.forEach(h => {
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
  // Al filtrar por municipio, limpiamos la categoría activa para no confundir
  activeCategoryHeaders = []; 
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
  // 1. Calcular KPIs Totales
  const totalEst = rows.reduce((acc, r) => acc + (r.__meta.totalEst || 0), 0);
  const totalDoc = rows.reduce((acc, r) => acc + (r.__meta.totalDoc || 0), 0);
  
  // Calcular Rural vs Urbano
  let sumRural = 0;
  let sumUrbano = 0;
  rows.forEach(r => {
      const z = r.__meta.zona; // normalizado
      const est = r.__meta.totalEst || 0;
      if(z.includes('rural')) sumRural += est;
      else if(z.includes('urban')) sumUrbano += est;
  });

  document.getElementById('kpiTotal').textContent = new Intl.NumberFormat().format(totalEst);
  document.getElementById('kpiSedes').textContent = new Intl.NumberFormat().format(rows.length);
  
  // Nuevos KPIs (Mejora #2)
  document.getElementById('kpiDocentes').textContent = new Intl.NumberFormat().format(totalDoc);
  document.getElementById('kpiRural').textContent = new Intl.NumberFormat().format(sumRural);
  document.getElementById('kpiUrbano').textContent = new Intl.NumberFormat().format(sumUrbano);

  // 2. Gráfico Sedes por Municipio (Mejora #3: Agrupado por Zona y Apilado)
  // Agrupar datos: { "Caceres": { rural: 10, urbano: 20 }, ... }
  const groups = {};
  
  // Inicializar municipios para orden correcto
  const muns = Array.from(new Set(rows.map(r => r["MUNICIPIO"] || "Otros"))).sort();
  muns.forEach(m => { groups[m] = { rural: 0, urbano: 0 }; });

  rows.forEach(r => {
    const m = r["MUNICIPIO"] || "Otros";
    const z = r.__meta.zona;
    const est = r.__meta.totalEst || 0; // ¿Graficamos # Sedes o # Estudiantes? 
    // La petición dice: "agrupando la cantidad de estudiantes por zona". OK.
    
    if(groups[m]) {
        if(z.includes('rural')) groups[m].rural += est;
        else groups[m].urbano += est;
    }
  });

  const labels = muns;
  const dataRural = labels.map(m => groups[m].rural);
  const dataUrbano = labels.map(m => groups[m].urbano);

  const ctx = document.getElementById('chartSedes');
  if(chartInstance) chartInstance.destroy();
  
  chartInstance = new Chart(ctx, {
    type: 'bar',
    // Activar plugin de etiquetas
    plugins: [ChartDataLabels],
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Rural',
          data: dataRural,
          backgroundColor: '#339966', // Verde (Rural)
          borderRadius: 4,
          stack: 'Stack 0'
        },
        {
          label: 'Urbano',
          data: dataUrbano,
          backgroundColor: '#336699', // Azul (Urbano)
          borderRadius: 4,
          stack: 'Stack 0'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'bottom' },
        datalabels: {
           display: function(context) {
             return context.dataset.data[context.dataIndex] > 0; // Ocultar si es 0
           },
           color: '#fff', // Texto blanco sobre las barras
           font: { weight: 'bold' },
           formatter: function(value) {
             return new Intl.NumberFormat().format(value);
           }
        }
      },
      scales: {
        x: { stacked: true },
        y: { stacked: true }
      }
    }
  });
}
