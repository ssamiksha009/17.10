// Copy ftire.js content and replace all instances of 'ftire' with 'cdtire' in the API endpoints

document.getElementById('logoutBtn').addEventListener('click', function() {
    window.location.href = '/login.html';
});

// Fallback helper: collect input values by id -> returns object { id: value }
// If another implementation exists elsewhere this will not override it.
if (typeof window.collectInputs === 'undefined') {
  window.collectInputs = function(ids = []) {
    const out = {};
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (!el) { out[id] = ''; return; }
      let v = el.value;
      if (v === undefined || v === null) { out[id] = ''; return; }
      v = String(v).trim();
      // convert plain numeric strings to Number (preserve empty and non-numeric)
      if (v !== '' && !Number.isNaN(Number(v)) && /^-?\d+(\.\d+)?$/.test(v.replace(/,/g,'.'))) {
        out[id] = Number(v.replace(/,/g,'.'));
      } else {
        out[id] = v;
      }
    });
    return out;
  };
}

// Add missing normalize() used by header-mapping and logging
function normalize(s) {
  if (s == null) return '';
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')   // remove invisible chars
    .replace(/[\[\]\(\)\.]/g, '')            // remove brackets/periods
    .replace(/[_\-]/g, ' ')
    .replace(/\s+/g, ' ');
}

document.getElementById('submitBtn').addEventListener('click', async function() {
    const errorMessage = document.getElementById('errorMessage');
    errorMessage.textContent = '';
    

// Only check the 4 required fields
const requiredIds = ['rimWidth', 'rimDiameter', 'l1', 'p1'];
let allValid = true;

requiredIds.forEach(id => {
    const input = document.getElementById(id);
    if (!input.value || isNaN(Number(input.value)) || Number(input.value) <= 0) {
        allValid = false;
        input.classList.add('invalid');
    } else {
        input.classList.remove('invalid');
    }
});

if (!allValid) {
    errorMessage.textContent = '* Please fill all required fields with positive numbers: Rim Width, Rim Diameter, Load 1, Pressure';
    errorMessage.style.display = 'block';
    return;
}
    
    // Persist current input values into projects.inputs when projectId present
    try {
      const pid = getProjectId();
      if (pid) {
        const ids = [
          'rimWidth', 'rimDiameter', 'nominalWidth', 'outerDiameter',
          'p1', 'l1', 'l2', 'l3', 'l4', 'l5', 'vel', 'ia', 'sr', 'aspectRatio'
        ];
        await saveInputs(pid, collectInputs(ids));
      }
    } catch (e) {
      console.warn('Failed to save inputs for project:', e);
    }

    const projectName = sessionStorage.getItem('currentProject') || 'DefaultProject';
    checkProjectExists(projectName, 'CDTire');
});

// Add function to check project existence and show confirmation
function checkProjectExists(projectName, protocol) {
    fetch('/api/check-project-exists', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            projectName: projectName,
            protocol: protocol
        })
    })
    .then(response => response.json())
    .then(data => {
        if (!data.success) {
            throw new Error(data.message || 'Error checking project existence');
        }
        
        // ✅ ONLY show prompt if project EXISTS IN DATABASE
        if (data.exists && data.project && data.project.id) {
            // Project exists, show confirmation dialog
            const userConfirmed = confirm(`Project "${data.folderName}" already exists. Do you want to Replace it?`);
            if (userConfirmed) {
                // User confirmed, proceed with workflow
                proceedWithSubmission();
            } else {
                // User cancelled, do nothing (stay on same page)
                return;
            }
        } else {
            // Project doesn't exist, proceed normally
            proceedWithSubmission();
        }
    })
    .catch(error => {
        const errorMessage = document.getElementById('errorMessage');
        errorMessage.style.color = '#d9534f';
        errorMessage.textContent = error.message || 'Error checking project status. Please try again.';
    });
}

async function proceedWithSubmission() {
    const meshFile = document.getElementById('meshFile').files[0];
    const errorMessage = document.getElementById('errorMessage');
    
    // Clear previous errors
    errorMessage.textContent = '';
    
    if (meshFile) {
        const formData = new FormData();
        formData.append('meshFile', meshFile);
        
        try {
            // Show loading state (optional)
            // e.g., disable submit button, show spinner
            
            const response = await fetch('/api/upload-mesh-file', {
                method: 'POST',
                body: formData
            });
            
            const data = await response.json();
            
            if (!data.success) {
                throw new Error(data.message || 'Failed to upload mesh file');
            }

            // Log mesh file upload
            try {
                await fetch('/api/activity-log', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        activity_type: 'File',
                        action: 'Mesh File Uploaded',
                        description: `Uploaded mesh file "${meshFile.name}" for MF5.2 protocol`,
                        status: 'success',
                        metadata: { filename: meshFile.name, protocol: 'MF5.2' }
                    })
                });
            } catch (logError) {
                console.warn('Failed to log mesh upload activity:', logError);
                // Consider: Should this prevent the process from continuing?
            }
            
            // Process the Excel file
            await processMF52Excel();
            
        } catch (error) {
            errorMessage.style.color = '#d9534f';
            errorMessage.textContent = error.message || 'Error uploading mesh file. Please try again.';
            console.error('Mesh file upload error:', error);
        }
    } else {
        try {
            await processCDTireExcel();
        } catch (error) {
            errorMessage.style.color = '#d9534f';
            errorMessage.textContent = error.message || 'Error processing Excel file. Please try again.';
            console.error('Excel processing error:', error);
        }
    }
}
// Extract Excel processing to a separate function
function processCDTireExcel() {
    const errorMessage = document.getElementById('errorMessage');
    
    const parameterData = {
        load1_kg: document.getElementById('l1').value,
        load2_kg: document.getElementById('l2').value,
        load3_kg: document.getElementById('l3').value,
        load4_kg: document.getElementById('l4').value,
        load5_kg: document.getElementById('l5').value,
        pressure1: document.getElementById('p1').value,
        speed_kmph: document.getElementById('vel').value,
        IA: document.getElementById('ia').value,
        SR: document.getElementById('sr').value,
        width: document.getElementById('rimWidth').value,
        diameter: document.getElementById('rimDiameter').value,
        Outer_diameter: document.getElementById('outerDiameter').value,
        nomwidth: document.getElementById('nominalWidth').value,
        aspratio: document.getElementById('aspectRatio').value
    };

    // Generate parameter file first
    fetch('/api/generate-parameters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parameterData)
    })
    .then(response => response.json())
    .then(data => {
        if (!data.success) throw new Error(data.message);
        return fetch('/api/read-protocol-excel', {
            headers: { 'Referer': '/cdtire.html' }
        });
    })
    .then(response => response.arrayBuffer())
    .then(data => {
        const workbook = XLSX.read(new Uint8Array(data), {type: 'array'});
        const outputWorkbook = XLSX.utils.book_new();
        
        workbook.SheetNames.forEach((sheetName) => {
            const worksheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet, {header: 1});
              const replacements = {
                'P1': document.getElementById('p1').value.trim() || null,
                'L1': document.getElementById('l1').value.trim() || null,
                'L2': document.getElementById('l2').value.trim() || null,
                'L3': document.getElementById('l3').value.trim() || null,
                'L4': document.getElementById('l4').value.trim() || null,
                'L5': document.getElementById('l5').value.trim() || null,
                'VEL': document.getElementById('vel').value.trim() || null,
                'SR': document.getElementById('sr').value.trim() || null,
                'IA': document.getElementById('ia').value.trim() || null
            };

            const newSheet = jsonData.map((row, rowIndex) => {
                if (!Array.isArray(row)) return row;
                
                // Store original P and L values for this row
                const originalPValues = [];
                const originalLValues = [];
                
                const modifiedRow = row.map(cell => {
                    if (!cell) return cell;
                    const cellStr = String(cell).trim();                    // Store original P values before replacement
                    if (cellStr.match(/^P[1-3]$/) || cellStr.toLowerCase() === 'ipref') {
                        originalPValues.push(cellStr);
                    }
                    
                    // Store original L values before replacement
                    if (cellStr.match(/^L[1-5]$/)) {
                        originalLValues.push(cellStr);
                    }
                    
                    // Handle velocity cases
                    if (cellStr.toLowerCase() === 'vel') {
                        return document.getElementById('vel').value.trim();
                    }
                    
                    // Handle IA replacements
                    if (cellStr === 'IA' || cellStr === '-IA') {
                        const iaValue = parseFloat(document.getElementById('ia').value.trim());
                        return cellStr.startsWith('-') ? (-Math.abs(iaValue)).toString() : iaValue.toString();
                    }
                    
                    // Handle SR replacements
                    if (cellStr === 'SR' || cellStr === '-SR') {
                        const srValue = parseFloat(document.getElementById('sr').value.trim());
                        return cellStr.startsWith('-') ? (-Math.abs(srValue)).toString() : srValue.toString();
                    }
                      // Handle P1 case-insensitively and also replace IPref with P1
                    if (cellStr.toLowerCase() === 'p1' || cellStr.toLowerCase() === 'ipref') {
                        return document.getElementById('p1').value.trim();
                    }
                    
                    // Handle other replacements
                    return replacements[cellStr] || cell;
                });
                
                // Find the actual end of the row (last non-empty cell + 1)
                let lastDataIndex = modifiedRow.length - 1;
                while (lastDataIndex >= 0 && (modifiedRow[lastDataIndex] === null || modifiedRow[lastDataIndex] === undefined || modifiedRow[lastDataIndex] === '')) {
                    lastDataIndex--;
                }
                
                // Extend row to ensure we have space for new columns
                const extendedRow = [...modifiedRow];
                while (extendedRow.length <= lastDataIndex + 2) {
                    extendedRow.push('');
                }
                
                // Add original P and L values in completely new columns at the end
                if (rowIndex === 0) {
                    extendedRow[lastDataIndex + 1] = 'Original P Values';
                    extendedRow[lastDataIndex + 2] = 'Original L Values';
                } else {
                    extendedRow[lastDataIndex + 1] = originalPValues.join(', ');
                    extendedRow[lastDataIndex + 2] = originalLValues.join(', ');
                }
                
                return extendedRow;
            });

            const modifiedWorksheet = XLSX.utils.aoa_to_sheet(newSheet);
            XLSX.utils.book_append_sheet(outputWorkbook, modifiedWorksheet, sheetName);
        });

        const excelBuffer = XLSX.write(outputWorkbook, { bookType: 'xlsx', type: 'array' });
        const formData = new FormData();
        formData.append('excelFile', new Blob([excelBuffer]), 'output.xlsx');

        return fetch('/api/save-excel', {
            method: 'POST',
            body: formData
        });
    })
    .then(response => response.json())
    .then(data => {
        if (!data.success) throw new Error(data.message);
        return fetch('/api/read-output-excel');
    })
    .then(response => response.arrayBuffer())
    .then(data => {
        const workbook = XLSX.read(new Uint8Array(data), {type: 'array'});
        const extractedData = [];

        workbook.SheetNames.forEach((sheetName) => {
            const worksheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet, {header: 1});
            
            // --- flexible header row detection (scan first 10 rows for header keywords) ---
            const headerCandidates = jsonData.slice(0, Math.min(10, jsonData.length));
            const allHeaderKeywords = [
              'no of tests','number of tests','no. of tests','runs','tests','count',
              'test name','test','tests','inflation pressure','pressure','pressure (bar)','psi','p1','p',
              'velocity','vel','speed','test velocity','preload','pre-load','pre load','camber','slip angle','displacement','slip range','cleat','road surface','job','template','tydex'
            ].map(normalize);

            let headerRowIndex = -1;
            for (let r = 0; r < headerCandidates.length; r++) {
                const row = headerCandidates[r];
                if (!Array.isArray(row)) continue;
                const normalized = row.map(normalize);
                // if row contains any of the known header keywords, treat as header
                if (normalized.some(cell => allHeaderKeywords.includes(cell))) {
                    headerRowIndex = r;
                    break;
                }
            }
            // fallback: first non-empty row
            if (headerRowIndex === -1) {
                for (let r = 0; r < Math.min(10, jsonData.length); r++) {
                    const row = jsonData[r];
                    if (Array.isArray(row) && row.some(c => c !== null && c !== undefined && String(c).trim() !== '')) {
                        headerRowIndex = r;
                        console.warn('Header row not detected by keywords — falling back to first non-empty row index', headerRowIndex);
                        break;
                    }
                }
            }
            if (headerRowIndex === -1) {
                headerRowIndex = 0;
                console.warn('Unable to detect header row — using row 0 as header');
            }

            let headerRow = jsonData[headerRowIndex];

            // If detected header row looks numeric (likely mis-detected), try to find a better header
            const looksNumericCell = (c) => {
                if (c === undefined || c === null) return false;
                const s = String(c).trim();
                if (s === '') return false;
                const cleaned = s.replace('%','').replace(/,/g,'.').replace(/[^0-9.\-]/g,'');

                return cleaned !== '' && !Number.isNaN(Number(cleaned));
            };
            const isMostlyNumericRow = (row) => {
                if (!Array.isArray(row)) return false;
                let total = 0, numeric = 0;
                for (const cell of row) {
                    if (cell === undefined || cell === null || String(cell).trim() === '') continue;
                    total++;
                    if (looksNumericCell(cell)) numeric++;
                }
                return total > 0 && (numeric / total) >= 0.7;
            };

            if (isMostlyNumericRow(headerRow)) {
                // search first 10 rows for a better candidate (most non-numeric / string cells)
                let bestIndex = headerRowIndex;
                let bestScore = -1;
                for (let r = 0; r < Math.min(10, jsonData.length); r++) {
                    const row = jsonData[r];
                    if (!Array.isArray(row)) continue;
                    let score = 0;
                    for (const cell of row) {
                        if (cell === undefined || cell === null) continue;
                        const s = String(cell).trim();
                        if (s === '') continue;
                        if (!looksNumericCell(s)) score++;
                    }
                    if (score > bestScore) { bestScore = score; bestIndex = r; }
                }
                if (bestIndex !== headerRowIndex && bestScore > 0) {
                    console.warn('Header row looked numeric; switching headerRowIndex from', headerRowIndex, 'to', bestIndex);
                    headerRowIndex = bestIndex;
                } else {
                    console.warn('Header row appears numeric but no better header found; keeping index', headerRowIndex);
                }
            }

            // reassign headerRow with final index
            headerRow = jsonData[headerRowIndex] || [];
            const headerMap = {};
            headerRow.forEach((h, i) => headerMap[normalize(h)] = i);

            // find best match from variants (keeps previous matching logic)
            const findByKeywords = (variants) => {
                for (const v of variants) {
                    const n = normalize(v);
                    if (n && typeof headerMap[n] === 'number') return headerMap[n];
                }
                const variantTokens = variants.map(v => normalize(v).split(' ').filter(Boolean));
                for (const key of Object.keys(headerMap)) {
                    const keyTokens = key.split(' ').filter(Boolean);
                    for (const vt of variantTokens) {
                        const common = vt.filter(t => keyTokens.includes(t));
                        if (common.length >= Math.max(1, Math.floor(vt.length / 2))) return headerMap[key];
                    }
                }
                return -1;
            };

            // keyword lists for likely columns
            const keywords = {
                runs: ['no of tests','number of tests','no. of tests','runs','tests','count','number'],
                testName: ['test name','test','name','test id'],
                pressure: ['inflation pressure','pressure','pressure bar','p1','p'],
                velocity: ['velocity','vel','speed','test velocity','km/h','kmh'],
                preload: ['preload','pre-load','pre load','preload n','n'],
                camber: ['camber'],
                slipAngle: ['slip angle','sa','slipangle'],
                displacement: ['displacement'],
                slipRange: ['slip range','slip ratio','sr'],
                cleat: ['cleat'],
                roadSurface: ['road surface','surface'],
                job: ['job'],
                old_job: ['old job','old_job'],
                template_tydex: ['template tydex','template'],
                tydex_name: ['tydex name','tydex','tydex_name','output name']
            };

            const columns = {};
            for (const k of Object.keys(keywords)) {
                columns[k] = findByKeywords(keywords[k]);
            }

            // Determine P and L columns (prefer header matches, else numeric fallback)
            const pCandidates = ['p','p1','pressure','inflation pressure','press'];
            const lCandidates = ['l','l1','load','load 1','load1','load kg','load (kg)'];

            let pColumnIndex = findByKeywords(pCandidates);
            let lColumnIndex = findByKeywords(lCandidates);

            const sampleRows = jsonData.slice(headerRowIndex + 1, headerRowIndex + 8);
            const isNumeric = (v) => {
                if (v == null) return false;
                const s = String(v).trim();
                if (s === '') return false;
                const cleaned = s.replace('%','').replace(/,/g,'.').replace(/[^0-9.\-]/g,'');

                return cleaned !== '' && !Number.isNaN(Number(cleaned));
            };
            const columnLooksNumeric = (colIndex) => {
                if (colIndex < 0) return false;
                let numericCount = 0, total = 0;
                for (const r of sampleRows) {
                    if (!r || r[colIndex] === undefined) continue;
                    total++;
                    if (isNumeric(r[colIndex])) numericCount++;
                }
                return total === 0 ? false : (numericCount / total) >= 0.6;
            };

            const usedIndices = new Set(Object.values(columns).filter(i => i >= 0));
            if (pColumnIndex === -1) {
                for (let i = 0; i < headerRow.length; i++) {
                    if (usedIndices.has(i)) continue;
                    if (columnLooksNumeric(i)) { pColumnIndex = i; break; }
                }
            }
            if (lColumnIndex === -1) {
                for (let i = 0; i < headerRow.length; i++) {
                    if (i === pColumnIndex) continue;
                    if (usedIndices.has(i)) continue;
                    if (columnLooksNumeric(i)) { lColumnIndex = i; break; }
                }
            }

            // If runs column not found via header, try to infer it (prefer small integer sequence)
            if (columns.runs === -1) {
                for (let i = 0; i < headerRow.length; i++) {
                    if (usedIndices.has(i) || i === pColumnIndex || i === lColumnIndex) continue;
                    if (!columnLooksNumeric(i)) continue;

                    let intCount = 0, total = 0;
                    const values = [];
                    for (const r of sampleRows) {
                        if (!r) continue;
                        const v = r[i];
                        if (v === undefined) continue;
                        total++;
                        if (isNumeric(v)) {
                            const n = Number(String(v).replace(/,/g,'.'));
                            if (Number.isFinite(n) && Math.abs(n - Math.round(n)) < 1e-6) {
                                intCount++;
                                values.push(Math.round(n));
                            }
                        }
                    }
                    const uniq = new Set(values);
                    if (total > 0 && (intCount / total) >= 0.6 && (uniq.size <= Math.max(3, sampleRows.length))) {
                        columns.runs = i;
                        break;
                    }
                }
            }

            console.log('Header row (normalized):', headerRow.map(normalize));
            console.log('Mapped columns (indices):', columns);
            console.log('P column index:', pColumnIndex, 'L column index:', lColumnIndex);

            for (const k of Object.keys(columns)) if (columns[k] === undefined) columns[k] = -1;

            // extraction: use incremental counter if runs column missing
            let implicitRunCounter = 1;
            const seenRuns = new Set();

            for (let r = headerRowIndex + 1; r < jsonData.length; r++) {
                const row = jsonData[r];
                if (!row || row.every(c => c === null || c === undefined || String(c).trim() === '')) continue;

                // Determine number_of_runs robustly
                let numRuns = null;
                if (columns.runs !== -1 && row[columns.runs] !== undefined && String(row[columns.runs]).trim() !== '') {
                    const v = String(row[columns.runs]).trim().replace(/,/g, '.');
                    const n = Number(v);
                    if (Number.isFinite(n)) numRuns = parseInt(n);
                }

                if (numRuns === null) {
                    const hasMeaningful = (pColumnIndex !== -1 && row[pColumnIndex] !== undefined && String(row[pColumnIndex]).trim() !== '') ||
                                          (lColumnIndex !== -1 && row[lColumnIndex] !== undefined && String(row[lColumnIndex]).trim() !== '') ||
                                          (columns.testName !== -1 && row[columns.testName] !== undefined && String(row[columns.testName]).trim() !== '');
                    if (!hasMeaningful) continue; // skip empty rows
                    // produce a unique implicit run id
                    while (seenRuns.has(implicitRunCounter)) implicitRunCounter++;
                    numRuns = implicitRunCounter++;
                }

                // skip if numRuns already seen (dedupe)
                if (seenRuns.has(numRuns)) {
                    console.warn('Skipping duplicate run number from Excel:', numRuns, 'rowIndex:', r);
                    continue;
                }

                // helper to clean cell value
                const cleanValue = (val) => {
                    if (val === undefined || val === null) return '';
                    return String(val).trim().replace(/\n/g, ' ');
                };

                const rowObj = {
                    number_of_runs: numRuns,
                    test_name: (columns.testName !== -1) ? cleanValue(row[columns.testName]) : '',
                    inflation_pressure: (columns.pressure !== -1) ? cleanValue(row[columns.pressure]) : (pColumnIndex !== -1 ? cleanValue(row[pColumnIndex]) : ''),
                    velocity: (columns.velocity !== -1) ? cleanValue(row[columns.velocity]) : '',
                    preload: (columns.preload !== -1) ? cleanValue(row[columns.preload]) : (lColumnIndex !== -1 ? cleanValue(row[lColumnIndex]) : ''),
                    camber: columns.camber !== -1 ? cleanValue(row[columns.camber]) : '',
                    slip_angle: columns.slipAngle !== -1 ? cleanValue(row[columns.slipAngle]) : '',
                    displacement: columns.displacement !== -1 ? cleanValue(row[columns.displacement]) : '',
                    slip_range: columns.slipRange !== -1 ? cleanValue(row[columns.slipRange]) : '',
                    cleat: columns.cleat !== -1 ? cleanValue(row[columns.cleat]) : '',
                    road_surface: columns.roadSurface !== -1 ? cleanValue(row[columns.roadSurface]) : '',
                    job: columns.job !== -1 ? cleanValue(row[columns.job]) : '',
                    old_job: columns.old_job !== -1 ? cleanValue(row[columns.old_job]) : '',
                    template_tydex: columns.template_tydex !== -1 ? cleanValue(row[columns.template_tydex]) : '',
                    tydex_name: columns.tydex_name !== -1 ? cleanValue(row[columns.tydex_name]) : '',
                    p: (pColumnIndex !== -1 && row[pColumnIndex] !== undefined) ? cleanValue(row[pColumnIndex]) : '',
                    l: (lColumnIndex !== -1 && row[lColumnIndex] !== undefined) ? cleanValue(row[lColumnIndex]) : ''
                };

                extractedData.push(rowObj);
                seenRuns.add(numRuns);
            }
        });

        if (extractedData.length === 0) {
            throw new Error('No valid data found in Excel file');
        }

        return fetch('/api/store-cdtire-data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: extractedData })
        });
    })
    .then(response => response.json())
    .then(data => {
        if (!data.success) throw new Error(data.message);
        
        // Create protocol-based folder structure
        const projectName = sessionStorage.getItem('currentProject') || 'DefaultProject';
        return fetch('/api/create-protocol-folders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                projectName: projectName,
                protocol: 'CDTire'
            })
        });
    })
    .then(response => {
        if (!response.ok) {
            return response.json().then(err => { throw new Error(err && err.message ? err.message : 'Error creating protocol folders'); });
        }
        return response.json();
    })
    .then(data => {
        if (!data.success) {
            throw new Error(data.message || 'Error creating protocol folders');
        }
        // Save matrix to permanent project table if projectId present
        const pid = getProjectId();
        if (pid) {
            return fetch('/api/store-project-matrix', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId: pid, protocol: 'CDTire' })
            })
            .then(resp => {
                if (!resp.ok) {
                    return resp.json().then(err => { throw new Error(err && err.message ? err.message : 'Failed to store project matrix'); });
                }
                return resp.json();
            });
        }
        return Promise.resolve({ ok: true });
    })
    .then(() => {
        updateTestSummary();
        window.location.href = '/select.html';
    })
    .catch(error => {
        const errorMessage = document.getElementById('errorMessage');
        errorMessage.style.color = '#d9534f';
        errorMessage.textContent = error.message || 'Error processing file. Please try again.';
    });
    // ...existing code...
}

function updateTestSummary() {
    fetch('/api/get-cdtire-summary')
        .then(response => {
            if (!response.ok) {
                console.error('Summary response status:', response.status);
                throw new Error('Network response was not ok');
            }
            return response.json();
        })
        .then(data => {
            console.log('Summary data received:', data); // Debug log
            const summaryContainer = document.getElementById('testSummary');
            if (!data || data.length === 0) {
                summaryContainer.innerHTML = '<div class="summary-item">No tests available</div>';
                return;
            }
            
            summaryContainer.innerHTML = data.map(item => `
                <div class="summary-item">
                    <span class="test-name">${item.test_name || 'Unknown'}:</span>
                    <span class="test-count">${item.count}</span>
                </div>
            `).join('');
        })
        .catch(error => {
            console.error('Error fetching test summary:', error);
            const summaryContainer = document.getElementById('testSummary');
            summaryContainer.innerHTML = '<div class="error-message">Unable to load test summary</div>';
        });
}

// ==== shared helpers ====
function getProjectId() {
  const qs = new URLSearchParams(location.search);
  return qs.get('projectId');
}
async function fetchProject(id) {
  const token = localStorage.getItem('authToken');
  const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
  const r = await fetch(`/api/projects/${id}`, { headers });
  if (r.status === 401) {
    // unauthorized — clear token and redirect to login
    localStorage.removeItem('authToken');
    window.location.href = '/login.html';
    throw new Error('Unauthorized');
  }
  if (!r.ok) throw new Error('Failed to fetch project');
  return r.json();
}
async function saveInputs(projectId, inputs) {
  const token = localStorage.getItem('authToken');
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  // Server expects drafts endpoint: /api/projects/:projectId/drafts/:protocol
  const url = `/api/projects/${encodeURIComponent(projectId)}/drafts/CDTire`;
  const body = { inputs_json: inputs };

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    // try to extract JSON message, fallback to text/status
    let msg = `HTTP ${resp.status}`;
    try {
      const j = await resp.json();
      msg = j && j.message ? j.message : JSON.stringify(j);
    } catch (e) {
      try { msg = await resp.text(); } catch (_) { msg = resp.statusText || msg; }
    }
    throw new Error(msg || 'Failed to save inputs');
  }

  return resp.json();
}