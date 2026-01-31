fetch('/api/config')
.then(res => res.json())
.then(config => {

    // Package Vars
    for (let pkvar in config.package) {
    let appvar = 'app_' + pkvar;

    // Select *all* elements with this class
    const elements = document.querySelectorAll('.' + appvar);
    // console.log(`Found ${elements.length} elements with .${appvar}`);

    elements.forEach(el => {
        // console.log(`Setting .${appvar} = ${config.package[pkvar]}`);

        switch (pkvar) {
            case 'license': {
                const lic = config.package.license;
                const licUrl = config.package.license_url;

                if (licUrl) {
                    el.innerHTML = `<a target="_blank" href="${licUrl}">${lic}</a>`;
                } else {
                    el.textContent = lic;
                }
                break;
            }

            case 'homepage':
                let home_html = `<a target="_blank" href="${config.package[pkvar]}">${config.package[pkvar]}</a>`;
                el.innerHTML = home_html;
                break;
            default:
                el.innerHTML = config.package[pkvar];
                break;
        }

    });
    }

    // Node.js
    let node_html = '';
    node_html += '<ul class="">'
    node_html += `  <li><b>Version:</b> ${config.nodejs.version}</li>`
    node_html += `  <li><b>Arch:</b> ${config.nodejs.arch}</li>`
    node_html += `  <li><b>Platform:</b> ${config.nodejs.platform}</li>`
    node_html += '</ul>';

    document.getElementById('nodejs').innerHTML = node_html;

    // Dependencies
    let dep_keys = ['name', 'version', 'license', 'homepage'];
    let dep_html = '';

    dep_html += '<div class="row g-3">'; // g-3 adds spacing between cards

    for (let dep in config.dependencies) {
        const depInfo = config.dependencies[dep];
        console.log('Dep: ' + dep);

        dep_html += `
            <div class="col-12 col-md-6 col-lg-4">
                <div class="card shadow-sm border-0 h-100">
                    <div class="card-body">
                        <h5 class="card-title text-primary">${depInfo.name || dep}</h5>
                        <ul class="list-unstyled small mb-0">
        `;

        for (let key of dep_keys) {
            if (!depInfo[key]) continue;
            if (key === 'homepage') {
                dep_html += `
                    <li><b>${key}:</b> 
                        <a href="${depInfo[key]}" target="_blank" class="link-primary text-decoration-none">
                            ${depInfo[key]}
                        </a>
                    </li>
                `;
            } else {
                dep_html += `<li><b>${key}:</b> ${depInfo[key]}</li>`;
            }
        }

        dep_html += `
                        </ul>
                    </div>
                </div>
            </div>
        `;
    }

    dep_html += '</div>';

    document.getElementById('dependancies').innerHTML = dep_html;


})  
