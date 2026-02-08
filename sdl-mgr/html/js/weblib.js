// Dynamically include fragments
async function includeFragment(id, url) {
    const res = await fetch(url);
    const html = await res.text();
    document.getElementById(id).innerHTML = html;
    }
  
// Load a markdown file into #page
async function loadMarkdown(page) {
  const mdPath = `/md/${page}.md`;

  try {
    const response = await fetch(mdPath);
    const hasMarkdown = response.ok;
    const mdText = hasMarkdown ? await response.text() : "";
    
    // Load nav metadata (top + sidepanel)
    const [navRes, sideNavRes] = await Promise.all([
      fetch('/api/nav'),
      fetch('/api/nav/sidepanel')
    ]);

    const navItems = await navRes.json();
    const sideNav = await sideNavRes.json();

    // ---- Locate metadata (nav.json first, then nav-sidepanel.json) ----
    let meta = null;

    // 1) nav.json — brand
    meta = navItems.find(item => item.brand === true && item.page === page);

    // 2) nav.json — top-level
    if (!meta) {
      meta = navItems.find(item => item.page === page);
    }

    // 3) nav.json — children
    if (!meta) {
      for (const item of navItems) {
        if (Array.isArray(item.children)) {
          const child = item.children.find(c => c.page === page);
          if (child) {
            meta = child;
            break;
          }
        }
      }
    }

    // 4) nav-sidepanel.json — section headers
    if (!meta) {
      for (const section of Object.values(sideNav)) {
        if (section.page === page) {
          meta = section;
          break;
        }
      }
    }

    // 5) nav-sidepanel.json — section items
    if (!meta) {
      for (const section of Object.values(sideNav)) {
        if (Array.isArray(section.items)) {
          const item = section.items.find(i => i.page === page);
          if (item) {
            meta = item;
            break;
          }
        }
      }
    }

    // Fallback
    if (!meta) {
      meta = {
        title: page,
        icon: ""
      };
    }


    // Fallback title if still not found
    if (!meta) {
      meta = {
        title: page,
        icon: ""
      };
    }

    // ---- Build header HTML (NOT passed to marked) ----
    const headerHtml = `
      <h1 class="page-title my-4">
        ${meta.icon ? `<i class="${meta.icon} me-3"></i>` : ""}
        ${meta.title}
      </h1>
    `;

    // ---- Render header directly ----
    const pageEl = document.getElementById('page');
    pageEl.innerHTML = headerHtml;

    // ---- Render Markdown content below header ----
    if (hasMarkdown) {
      pageEl.innerHTML += marked.parse(mdText);
    } else {
      pageEl.innerHTML += marked.parse(`
> No markdown file found for: \`${page}.md\`
`);
    }

    // Load optional page-specific JS
    await loadPageScript(page);

    // Re-render MathJax
    if (window.MathJax?.typesetPromise) {
      await MathJax.typesetPromise();
    }

  } catch (err) {
    console.error(err);
    document.getElementById('page').innerHTML =
      `<pre>Error loading Markdown: ${err.message}</pre>`;
  }
}


// Dynamically load a JS file if it exists
async function loadPageScript(page) {
  const jsPath = `/js/${page}.js`;  // ✅ declare properly

  try {
    // HEAD request checks whether the file exists without downloading it
    const res = await fetch(jsPath, { method: 'HEAD' });

    if (!res.ok) {
      console.warn(`Script not found: ${jsPath}`);
      return;
    }

    // Dynamically inject script into the DOM
    const script = document.createElement('script');
    script.type = 'module';
    script.src = jsPath;
    script.defer = true;

    document.body.appendChild(script);
    console.log(`Loading script: ${jsPath}`);
  } catch (err) {
    console.warn(`Error loading script ${jsPath}: ${err.message}`);
  }
}


  // Load Nav
function loadNav() {
  fetch('/api/nav')
    .then(res => res.json())
    .then(navItems => {
      const navContainer = document.getElementById('nav');
      if (!navContainer) return;

      const urlParams = new URLSearchParams(window.location.search);
      const currentPage = urlParams.get('page') || 'index';

      const enabledItems = navItems.filter(item => item.enabled !== false);

      // --------- FIND BRAND ITEM ----------
      const brandItem = enabledItems.find(x => x.brand === true);

      // --------- CREATE NAV STRUCTURE ----------
      const navEl = document.createElement('nav');
      navEl.className = 'navbar navbar-expand-lg bg-body-tertiary';

      const container = document.createElement('div');
      container.className = 'container-fluid';

      // BRAND
      if (brandItem) {
        const brand = document.createElement('a');
        brand.className = 'navbar-brand';
        brand.href = `index.html?page=${brandItem.page}`;
        brand.innerHTML = `<i class="${brandItem.icon} me-2"></i>${brandItem.title}`;
        container.appendChild(brand);
      }

      // TOGGLER BUTTON
      const toggler = document.createElement('button');
      toggler.className = 'navbar-toggler';
      toggler.type = 'button';
      toggler.setAttribute('data-bs-toggle', 'collapse');
      toggler.setAttribute('data-bs-target', '#navbarNavDropdown');
      toggler.setAttribute('aria-controls', 'navbarNavDropdown');
      toggler.setAttribute('aria-expanded', 'false');
      toggler.setAttribute('aria-label', 'Toggle navigation');
      toggler.innerHTML = '<span class="navbar-toggler-icon"></span>';
      container.appendChild(toggler);

      // COLLAPSE REGION
      const collapse = document.createElement('div');
      collapse.className = 'collapse navbar-collapse';
      collapse.id = 'navbarNavDropdown';

      const ul = document.createElement('ul');
      ul.className = 'navbar-nav me-auto mb-2 mb-lg-0';

      enabledItems.forEach(item => {
        // skip the brand from the menu
        if (item.brand === true) return;

        const hasChildren = Array.isArray(item.children) && item.children.length > 0;
        const li = document.createElement('li');
        li.className = hasChildren ? 'nav-item dropdown' : 'nav-item';

        // --- NO CHILDREN: NORMAL NAV LINK ---
        if (!hasChildren) {
          const a = document.createElement('a');
          let cls = 'nav-link';
          if (item.page === currentPage) cls += ' active';

          a.className = cls;
          a.href = `index.html?page=${item.page}`;
          a.innerHTML = `<i class="${item.icon} me-2"></i>${item.title}`;

          li.appendChild(a);
          ul.appendChild(li);
          return;
        }

        // --- HAS CHILDREN: DROPDOWN TOGGLE ---
        const toggle = document.createElement('a');
        toggle.className = 'nav-link dropdown-toggle';
        toggle.href = '#';
        toggle.role = 'button';
        toggle.setAttribute('data-bs-toggle', 'dropdown');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.innerHTML = `<i class="${item.icon} me-2"></i>${item.title}`;

        const menu = document.createElement('ul');
        menu.className = 'dropdown-menu';

        item.children
          .filter(child => child.enabled !== false)
          .forEach(child => {
            const childLi = document.createElement('li');
            const childA = document.createElement('a');

            let childClass = 'dropdown-item';
            if (child.page === currentPage) {
              childClass += ' active';
              toggle.classList.add('active'); // highlight parent
            }

            childA.className = childClass;
            childA.href = `index.html?page=${child.page}`;
            childA.innerHTML =
              `${child.icon ? `<i class="${child.icon} me-2"></i>` : ''}${child.title}`;

            childLi.appendChild(childA);
            menu.appendChild(childLi);
          });

        li.appendChild(toggle);
        li.appendChild(menu);
        ul.appendChild(li);
      });

      collapse.appendChild(ul);
      container.appendChild(collapse);
      navEl.appendChild(container);

      navContainer.innerHTML = '';
      navContainer.appendChild(navEl);

      // --------- MANUAL DROPDOWN HANDLERS ---------
      const dropdownToggles = navContainer.querySelectorAll('.nav-item.dropdown > .dropdown-toggle');

      dropdownToggles.forEach(toggle => {
        toggle.addEventListener('click', evt => {
          evt.preventDefault();

          const parentLi = toggle.parentElement;
          const menu = parentLi.querySelector('.dropdown-menu');
          const isShown = menu.classList.contains('show');

          // close all others
          navContainer.querySelectorAll('.dropdown-menu.show').forEach(openMenu => {
            openMenu.classList.remove('show');
          });

          // toggle current
          if (!isShown) {
            menu.classList.add('show');
          }
        });
      });

      // close dropdown when clicking outside nav
      document.addEventListener('click', evt => {
        if (!navContainer.contains(evt.target)) {
          navContainer.querySelectorAll('.dropdown-menu.show').forEach(openMenu => {
            openMenu.classList.remove('show');
          });
        }
      });
    })
    .catch(err => {
      console.error('Failed to load nav:', err);
      const navContainer = document.getElementById('nav');
      if (navContainer) {
        navContainer.innerHTML =
          '<p class="text-danger">Failed to load navigation menu.</p>';
      }
    });
}



function loadNavTabs() {
    fetch('/api/nav')
      .then(res => res.json())
      .then(navItems => {
        const ul = document.createElement('ul');
        ul.className = 'nav nav-tabs';
  
        const urlParams = new URLSearchParams(window.location.search);
        const currentPage = urlParams.get('page') || 'index';
  
         // Filter out disabled items
        const enabledItems = navItems.filter(item => item.enabled !== false); 

        enabledItems.forEach(item => {
          const li = document.createElement('li');
          li.className = 'nav-item';
  
          const a = document.createElement('a');
          a.className = 'nav-link';
          a.href = `index.html?page=${item.page}`;
          a.innerHTML = `<i class="${item.icon} me-2"></i>${item.title}`;
  
          // Apply 'active' class to the current tab
          if (currentPage === item.page) {
            a.classList.add('active');
            a.setAttribute('aria-current', 'page');
          }
  
          // Optional: Support for disabled nav items in nav.json
          if (item.disabled) {
            a.classList.add('disabled');
            a.setAttribute('aria-disabled', 'true');
          }
  
          li.appendChild(a);
          ul.appendChild(li);
        });
  
        const navContainer = document.getElementById('nav');
        if (navContainer) {
          navContainer.innerHTML = ''; // Clear previous content
          navContainer.appendChild(ul);
        }
      })
      .catch(err => {
        console.error("Failed to load nav:", err);
        document.getElementById('nav').innerHTML =
          '<p class="text-danger">Failed to load navigation menu.</p>';
      });
  }



  // ===============================
// Side Panel (layout-collapsing)
// ===============================
// async function loadSidePanel() {
//   // console.log('DEBUG: loadSidePanel() called');

//   const panel = document.getElementById('sidepanel');
//   const inner = document.getElementById('sidepanel-inner');
//   const toggleBtn = document.getElementById('sidepanel-toggle');

//   if (!panel || !inner || !toggleBtn) return;

//   const currentPage =
//     new URLSearchParams(window.location.search).get('page') || 'index';

//   const isCollapsed =
//     localStorage.getItem('sidepanel_collapsed') === 'true';

//   if (isCollapsed) {
//     panel.classList.add('collapsed');
//     // toggleBtn.innerHTML = `<i class="fa-solid fa-folder-plus"></i>`;
//     toggleBtn.innerHTML = '<i class="bi bi-layout-sidebar"></i>';
//   } else {
//     // toggleBtn.innerHTML = `<i class="fa-solid fa-folder-minus"></i>`;
//     toggleBtn.innerHTML = '<i class="bi bi-layout-sidebar-reverse"></i>';
//   }

//   try {
//     const res = await fetch('/api/nav/sidepanel');
//     if (!res.ok) throw new Error(`HTTP ${res.status}`);

//     const sideNav = await res.json();

//     renderAllSidePanelSections(inner, sideNav, currentPage);
//   } catch (err) {
//     console.error('Failed to load side panel:', err);
//     inner.innerHTML = '';
//   }

//   // Collapse / expand behavior
//   toggleBtn.onclick = () => {
//     const collapsed = panel.classList.toggle('collapsed');
//     localStorage.setItem('sidepanel_collapsed', collapsed);

//     // toggleBtn.innerHTML = `
//     //   <i class="fa-solid ${
//     //     collapsed ? 'fa-folder-plus' : 'fa-folder-minus'
//     //   }"></i>
//     // `;

//     toggleBtn.innerHTML = `
//       <i class="bi ${
//         collapsed ? 'bi-layout-sidebar' : 'bi-layout-sidebar-reverse'
//       }"></i>
//     `;
//   };
// }
async function loadSidePanel() {
  const panel = document.getElementById('sidepanel');
  const inner = document.getElementById('sidepanel-inner');
  const toggleBtn = document.getElementById('sidepanel-toggle');
  
  if (!panel || !inner || !toggleBtn) return;
  
  const currentPage =
    new URLSearchParams(window.location.search).get('page') || 'index';
  const isCollapsed =
    localStorage.getItem('sidepanel_collapsed') === 'true';
  
  if (isCollapsed) {
    panel.classList.add('collapsed');
    toggleBtn.innerHTML = '<i class="bi bi-layout-sidebar"></i>';
  } else {
    toggleBtn.innerHTML = '<i class="bi bi-layout-sidebar-reverse"></i>';
  }
  
  try {
    const res = await fetch('/api/nav/sidepanel');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);  // ✅ Fixed template literal
    const sideNav = await res.json();
    renderAllSidePanelSections(inner, sideNav, currentPage);
  } catch (err) {
    console.error('Failed to load side panel:', err);
    inner.innerHTML = '';
  }
  
  // Collapse / expand behavior
  toggleBtn.onclick = () => {
    const collapsed = panel.classList.toggle('collapsed');
    localStorage.setItem('sidepanel_collapsed', collapsed);
    toggleBtn.innerHTML = `
      <i class="bi ${collapsed ? 'bi-layout-sidebar' : 'bi-layout-sidebar-reverse'}"></i>
    `;
  };
}

// -------------------------------
// Find matching section by page
// -------------------------------
function findSidePanelSection(sideNav, page) {
  for (const key in sideNav) {
    const section = sideNav[key];
    if (!section || section.enabled === false) continue;

    if (Array.isArray(section.items)) {
      const hit = section.items.find(
        item => item.enabled !== false && item.page === page
      );
      if (hit) return section;
    }
  }
  return null;
}

// -------------------------------
// Render side panel content
// -------------------------------
function renderAllSidePanelSections(container, sideNav, currentPage) {
  container.innerHTML = '';

  Object.values(sideNav)
    .filter(section => section.enabled !== false)
    .forEach(section => {

      // ---- Section Header (linkable if page exists) ----
      const header = document.createElement(
        section.page ? 'a' : 'div'
      );

      if (section.desc) {
        header.title = section.desc;
      }


      header.className =
        'fw-bold px-3 pt-3 pb-2 small nav-link';
        // 'fw-bold px-3 pt-3 pb-2 text-uppercase small nav-link';

      if (section.page) {
        header.href = `index.html?page=${section.page}`;
        if (section.page === currentPage) {
          header.classList.add('active');
        }
      }

      header.innerHTML = `
        ${section.icon ? `<i class="${section.icon} me-2"></i>` : ''}
        ${section.title}
      `;

      container.appendChild(header);

      // ---- Section Items (if any) ----
      if (Array.isArray(section.items) && section.items.length > 0) {
        const ul = document.createElement('ul');
        ul.className = 'nav flex-column px-2';

        section.items
          .filter(item => item.enabled !== false)
          .forEach(item => {
            const li = document.createElement('li');
            li.className = 'nav-item';

            const a = document.createElement('a');
            a.className = 'nav-link py-2';
            if (item.page === currentPage) {
              a.classList.add('active');
            }

            if (item.desc) {
              a.title = item.desc;
            }

            a.href = `index.html?page=${item.page}`;
            a.innerHTML = `
              ${item.icon ? `<i class="${item.icon} me-2"></i>` : ''}
              ${item.title}
            `;

            li.appendChild(a);
            ul.appendChild(li);
          });

        container.appendChild(ul);
      }
    });
}


  
 
// Load Footer
function loadFooter() {
  // Load API Config JSON from /api/config
  fetch('/api/config')
    .then(res => res.json())
    .then(config => {
      let html = '';
      html += '<footer class="text-center text-muted py-4">\n';
      html += '<div class="row">\n';

      html += '<div class="col-2"></div>';      

      html += '<div class="col-4">\n';
      html += `  <a href="${config.package.homepage}" target="_blank" class="">\n`;
      html += '    <i class="fas fa-square-binary"></i> ' + config.package.description + '\n';
      html += '  </a><br>\n';
      html += '</div>\n';

      // Add GitHub link from config.package.homepage
      html += '<div class="col-4">\n';
      if (config.package.repository.url) {
        html += `  <a href="${config.package.repository.url}" target="_blank" class="">\n`;
        html += '    <i class="fab fa-github fa-lg me-1"></i> ' + config.package.repository.url + '\n';
        html += '  </a><br>\n';
      }
      html += '</div>\n';

      html += '<div class="col-2"></div>';      

      html += '<div class="col-3"></div>';      
      // Add copyright
      html += '<div class="col-2">';
      if (config.package?.version) {
        // html += '<br>\n';
        html += `Version: ${config.package.version}\n`;
      }
      html += '</div>';

      html += '<div class="col-3">';
      html += `Copyright &copy; <span class="">${config.package.copyright || ''}</span>`;
      html += '</div>';

      // Add license if present
      html += '<div class="col-2">';
      if (config.package?.license) {
        html += `License: <a target="_blank" href="${config.package.license_url}">${config.package.license}</a>`;
      }
      html += '</div>';

      html += '<div class="col-3"></div>';      

      html += '</div>\n';

      html += '</footer>\n';
      // document.getElementById('app-description').innerHTML = config.package.description;
      document.getElementById('footer').innerHTML = html;
    })
    .catch(err => {
      console.error('Error loading config:', err);
      document.getElementById('footer').innerHTML = '<footer class="text-center text-muted py-4">Footer could not be loaded</footer>';
    });
}


export function genBootStrapTable(json_obj, tblsize='1') {

  // json_obj structure
  // [
  //   [
  //     "value1",
  //     "value2",
  //     "value3"
  //   ],
  //   [
  //     "value1",
  //     "value2",
  //     "value3"
  //   ]
  // ]

  // console.log("json_obj: ", JSON.stringify(json_obj, null, 2));
  // console.log("tblsize: ", tblsize);
  
  // A basic table with rows of content and no headers.
  let html = '';
  html += '<table class="table table-hover" style="font-size: ' + tblsize + 'em;">\n';
  html += '<tbody>\n';
  for (let row in json_obj) {
    html += `<tr>\n`;
    for (let col in json_obj[row]) {
      html += `<td>${json_obj[row][col]}</td>\n`;
    }
    html += `</tr>\n`;
  }
  html += '</tbody>\n';
  html += '</table>\n';
  return html;
} 

// SQL JSON To Bootstrap Table
export function sqlJsonToBootstrapTable(json_obj, col_disp_map) {
  // console.log("Running sqlJsonToBootstrapTable");
  // console.log("json_obj: ", JSON.stringify(json_obj, null, 2));

  let table_html = '';

  if (json_obj.length == 0) {
    table_html += "<p>No results found</p>\n";
    return table_html;
  } else {
  
    table_html += "<table class=\"table table-striped table-hover\">\n";

    table_html += "<thead>\n";
    table_html += "<tr>\n";
    
    // Get column names
    let cols = [];

    for (let col in json_obj[0]) {
      cols.push(col);
    }

    // console.log("cols: ", JSON.stringify(cols, null, 2));
    // console.log("col_disp_map: ", JSON.stringify(col_disp_map, null, 2));

    // Add column names to table
    for (let col in cols) {
      // table_html += `<th>${cols[col]}</th>\n`;
      // console.log(`cols[col]: ${cols[col]}`);
      table_html += `<th>${col_disp_map[cols[col]]}</th>\n`;
    }
    table_html += "</tr>\n";
    table_html += "</thead>\n";

    for (let row in json_obj) {
      table_html += "<tr>\n";
      for (let col in cols) {
        switch (cols[col]) {
          case 'id':
            table_html += `
              <td class="text-center">
                <input type="checkbox" class="row-select" data-id="${json_obj[row][cols[col]]}">
                ${json_obj[row][cols[col]]}
              </td>\n`;
            break;
          
            case 'balance': {
              const val = Number(json_obj[row][cols[col]]);
              if (!isNaN(val)) {
                const formatted = val.toLocaleString('en-US', {
                  style: 'currency',
                  currency: 'USD'
                });
                table_html += `<td>${formatted}</td>\n`;
              } else {
                table_html += `<td>${json_obj[row][cols[col]]}</td>\n`;
              }
              break;
            }
            

          case 'trans_amount': {
            const val = Number(json_obj[row][cols[col]]);
            if (!isNaN(val)) {
              const formatted = val.toLocaleString('en-US', {
                style: 'currency',
                currency: 'USD'
              });
              table_html += `<td>${formatted}</td>\n`;
            } else {
              table_html += `<td>${json_obj[row][cols[col]]}</td>\n`;
            }
            break;
          }

          case 'trans_id':
            // Fixed width, monospace for alignment
            table_html += `<td style="width:${json_obj[row][cols[col]].length + 2}ch">${json_obj[row][cols[col]]}</td>\n`;
            // table_html += `<td style="width: 20ch; font-family: monospace;">${json_obj[row][cols[col]]}</td>\n`;
            break;

          case 'trans_date':
            // Fixed width, monospace for alignment
            table_html += `<td style="width:${json_obj[row][cols[col]].length + 2}ch">${json_obj[row][cols[col]]}</td>\n`;
            // table_html += `<td style="width: 20ch; font-family: monospace;">${json_obj[row][cols[col]]}</td>\n`;
            break;

          case 'notes':
            table_html += `<td style="width:25ch">${json_obj[row][cols[col]]}</td>\n`;
            break;

          default:
            table_html += `<td>${json_obj[row][cols[col]]}</td>\n`;
            break;
        }
        // table_html += `<td>${json_obj[row][cols[col]]}</td>\n`;
      }
      table_html += "</tr>\n";
    }

    table_html += "</tbody>\n";

    table_html += "</table>\n";

    // console.log("Table HTML: ");
    // console.log(table_html);

    return table_html;
  }

}

// Load config (always from API)
export async function loadConfig() {
  const res = await fetch('/api/config', { cache: 'no-store' });
  return await res.json();
}

// Load config
// export async function loadConfig() {
//   const cached = sessionStorage.getItem('ssl_config');
//   if (cached) {
//     // console.log('Loaded config from cache');
//     return JSON.parse(cached);
//   }

//   const res = await fetch('/api/config');
//   const config = await res.json();
//   sessionStorage.setItem('ssl_config', JSON.stringify(config));
//   // console.log('Fetched config from backend');
//   return config;
// }

export async function getConfig() {
  const res = await fetch('/api/config', { cache: 'no-store' });
  return await res.json();
}

// export async function getConfig() {
//   const cached = sessionStorage.getItem('ssl_config');
//   if (!cached) {
//     throw new Error('ssl_config not found in sessionStorage');
//   }
//   return JSON.parse(cached);
// }


// // Load tags
// export async function loadTags(forceRefresh = false) {
//   if (!forceRefresh) {
//     const cached = localStorage.getItem('app_tags');
//     if (cached) {
//       // console.log('Loaded tags from cache');
//       return JSON.parse(cached);
//     }
//   }

//   const res = await fetch('/api/sql/query/tags');   // ✅ wait for fetch to resolve
//   const tags = await res.json();                    // ✅ wait for JSON parsing
//   localStorage.setItem('app_tags', JSON.stringify(tags));
//   // console.log('Fetched tags from backend');
//   return tags;
// }


// export async function refreshTags() {
//   const tags = await loadTags(true); // force refresh
//   // console.log('Tags reloaded:', tags);
// }


// export async function tag_badge(tag, active = true) {
//   const tags = JSON.parse(localStorage.getItem('app_tags')) || [];
//   const t = tags.find(x => x.name === tag);
//   if (!t) return `<span class="badge bg-warning" title="Tag not found">${tag}</span>`;

//   const safeName = t.name.replace(/\W+/g, '_');

//   const styleActive = `background-color:${t.color};border-color:${t.color};color:#fff;`;
//   const styleInactive = `color:${t.color};background-color:#e9ecef;border:1px solid ${t.color};`;
//   const style = active ? styleActive : styleInactive;

//   return `<span class="tag_${safeName} badge rounded-pill tag-toggle"
//                data-tag="${t.name}"
//                data-active="${active}"
//                style="${style}"
//                title="${t.description}"
//                onclick="toggleTag('${t.name.replace(/'/g, "\\'")}')">
//             ${t.name}
//           </span>`;
// }




export async function getLocalTimestamp() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const offset = -now.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const offsetHours = pad(Math.floor(Math.abs(offset) / 60));
  const offsetMinutes = pad(Math.abs(offset) % 60);
  return `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}${sign}${offsetHours}:${offsetMinutes}`;
}

export async function getUTCTimestamp() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${pad(now.getUTCMonth()+1)}-${pad(now.getUTCDate())}T${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}Z`; 
}




// ===============================
// Load on page load
// ===============================
window.addEventListener('DOMContentLoaded', async () => {
  // Apply saved theme (default to dark)
  const savedTheme = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-bs-theme', savedTheme);

  const config = await loadConfig();
  // console.log(`DEBUG: ${JSON.stringify(config)}`)

  // const tags = await loadTags();
  // console.log(`DEBUG: ${JSON.stringify(tags)}`)

  // Load fragments and layout
  includeFragment('banner', '/banner.html');
  // includeFragment('footer', '/footer.html');

  loadNav();

  loadSidePanel();

  loadFooter();


  // Load Markdown content
  const urlParams = new URLSearchParams(window.location.search);
  const page = urlParams.get('page') || 'index';
  loadMarkdown(`${page}`);

  // Update title and app description
  if (config?.package?.description) {
    document.title = config.package.description;

    const descEl = document.querySelector('.app-description');
    if (descEl) descEl.innerHTML = config.package.description;
  }
});