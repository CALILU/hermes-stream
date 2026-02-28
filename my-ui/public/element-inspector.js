/**
 * Element Inspector - Herramienta de desarrollo
 * Shift + Click derecho sobre cualquier elemento para ver su información
 * Arrastra el header para mover la ventana
 */

(function() {
    'use strict';

    // Crear el modal
    const modalHTML = `
        <div id="element-inspector-modal" class="ei-modal" style="display: none;">
            <div class="ei-modal-header" id="ei-drag-handle">
                <h3><span class="ei-drag-icon">&#9776;</span> Inspector de Elemento</h3>
                <span class="ei-close">&times;</span>
            </div>
            <div class="ei-modal-body">
                <pre id="ei-element-info"></pre>
            </div>
            <div class="ei-modal-footer">
                <button id="ei-copy-btn" class="ei-btn ei-btn-primary">
                    Copiar
                </button>
                <button id="ei-close-btn" class="ei-btn ei-btn-secondary">
                    Aceptar
                </button>
            </div>
        </div>
    `;

    // Estilos del modal
    const styles = `
        .ei-modal {
            position: fixed;
            top: 20px;
            right: 20px;
            background: #1e1e1e;
            border-radius: 8px;
            width: 420px;
            max-height: calc(100vh - 40px);
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255,255,255,0.1);
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            z-index: 99999;
            display: flex;
            flex-direction: column;
            resize: both;
            overflow: hidden;
            min-width: 320px;
            min-height: 200px;
        }
        .ei-modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 15px;
            background: #007acc;
            color: white;
            border-radius: 8px 8px 0 0;
            flex-shrink: 0;
            cursor: move;
            user-select: none;
        }
        .ei-modal-header h3 {
            margin: 0;
            font-size: 14px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .ei-drag-icon {
            opacity: 0.7;
            font-size: 12px;
        }
        .ei-modal-header:active {
            cursor: grabbing;
        }
        .ei-close {
            font-size: 24px;
            cursor: pointer;
            opacity: 0.8;
            transition: opacity 0.2s;
        }
        .ei-close:hover {
            opacity: 1;
        }
        .ei-modal-body {
            padding: 15px;
            flex: 1;
            overflow-y: auto;
            overflow-x: hidden;
            min-height: 0;
        }
        #ei-element-info {
            margin: 0;
            padding: 12px;
            background: #2d2d2d;
            border-radius: 4px;
            color: #d4d4d4;
            font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
            font-size: 11px;
            line-height: 1.3;
            white-space: pre-wrap;
            word-break: break-word;
            border: 1px solid #3c3c3c;
        }
        .ei-modal-footer {
            padding: 12px 15px;
            display: flex;
            justify-content: flex-end;
            flex-shrink: 0;
            gap: 10px;
            border-top: 1px solid #3c3c3c;
        }
        .ei-btn {
            padding: 8px 20px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 8px;
            transition: all 0.2s;
        }
        .ei-btn-primary {
            background: #007acc;
            color: white;
        }
        .ei-btn-primary:hover {
            background: #005a9e;
        }
        .ei-btn-secondary {
            background: #3c3c3c;
            color: #d4d4d4;
        }
        .ei-btn-secondary:hover {
            background: #4a4a4a;
        }
        .ei-highlight {
            outline: 3px solid #ff6b00 !important;
            outline-offset: 3px;
            box-shadow: 0 0 0 6px rgba(255, 107, 0, 0.3), 0 0 20px rgba(255, 107, 0, 0.5) !important;
            position: relative;
            z-index: 99998 !important;
        }
        .ei-highlight::before {
            content: '';
            position: absolute;
            top: -3px;
            left: -3px;
            right: -3px;
            bottom: -3px;
            border: 2px dashed #fff;
            pointer-events: none;
            animation: ei-pulse 1.5s ease-in-out infinite;
        }
        @keyframes ei-pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
        .ei-copied {
            background: #28a745 !important;
        }
        .ei-dragging {
            opacity: 0.9;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255,255,255,0.1);
        }
    `;

    // Inyectar estilos
    const styleSheet = document.createElement('style');
    styleSheet.textContent = styles;
    document.head.appendChild(styleSheet);

    // Inyectar modal
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    const modal = document.getElementById('element-inspector-modal');
    const dragHandle = document.getElementById('ei-drag-handle');
    const infoContainer = document.getElementById('ei-element-info');
    const copyBtn = document.getElementById('ei-copy-btn');
    const closeBtn = document.getElementById('ei-close-btn');
    const closeX = document.querySelector('.ei-close');

    let currentInfo = '';
    let highlightedElement = null;

    // Variables para drag and drop
    let isDragging = false;
    let dragOffsetX = 0;
    let dragOffsetY = 0;

    // Funcionalidad de arrastre
    dragHandle.addEventListener('mousedown', function(e) {
        if (e.target === closeX) return; // No arrastrar si se hace clic en cerrar

        isDragging = true;
        modal.classList.add('ei-dragging');

        const rect = modal.getBoundingClientRect();
        dragOffsetX = e.clientX - rect.left;
        dragOffsetY = e.clientY - rect.top;

        e.preventDefault();
    });

    document.addEventListener('mousemove', function(e) {
        if (!isDragging) return;

        let newX = e.clientX - dragOffsetX;
        let newY = e.clientY - dragOffsetY;

        // Limitar dentro de la ventana
        const maxX = window.innerWidth - modal.offsetWidth;
        const maxY = window.innerHeight - modal.offsetHeight;

        newX = Math.max(0, Math.min(newX, maxX));
        newY = Math.max(0, Math.min(newY, maxY));

        modal.style.left = newX + 'px';
        modal.style.top = newY + 'px';
        modal.style.right = 'auto';
    });

    document.addEventListener('mouseup', function() {
        if (isDragging) {
            isDragging = false;
            modal.classList.remove('ei-dragging');
        }
    });

    // Función para obtener información del elemento
    function getElementInfo(element) {
        const rect = element.getBoundingClientRect();
        const computedStyle = window.getComputedStyle(element);

        function getElementPath(el) {
            const path = [];
            while (el && el.nodeType === Node.ELEMENT_NODE) {
                let selector = el.tagName.toLowerCase();
                if (el.id) {
                    selector += `#${el.id}`;
                } else if (el.className && typeof el.className === 'string') {
                    const classes = el.className.trim().split(/\s+/).filter(c => c && !c.startsWith('ei-'));
                    if (classes.length > 0) {
                        selector += `.${classes.join('.')}`;
                    }
                }
                path.unshift(selector);
                el = el.parentElement;
            }
            return path.join(' > ');
        }

        function getAttributes(el) {
            const attrs = {};
            for (const attr of el.attributes) {
                if (!attr.name.startsWith('data-ei-')) {
                    attrs[attr.name] = attr.value;
                }
            }
            return attrs;
        }

        function getInlineEvents(el) {
            const events = [];
            const eventAttrs = ['onclick', 'onchange', 'onsubmit', 'oninput', 'onkeyup', 'onkeydown', 'onfocus', 'onblur', 'onmouseover', 'onmouseout'];
            eventAttrs.forEach(evt => {
                if (el.hasAttribute(evt)) {
                    events.push(`${evt}="${el.getAttribute(evt)}"`);
                }
            });
            return events.length > 0 ? events.join('\n') : "(ninguno)";
        }

        function getParentContainer(el) {
            let parent = el.parentElement;
            let depth = 0;
            while (parent && depth < 5) {
                if (parent.id || (parent.className && /form|container|modal|card|section|panel|wrapper/i.test(parent.className))) {
                    let selector = parent.tagName.toLowerCase();
                    if (parent.id) selector += `#${parent.id}`;
                    else if (parent.className) {
                        const mainClass = parent.className.split(/\s+/).find(c => /form|container|modal|card|section|panel|wrapper/i.test(c));
                        if (mainClass) selector += `.${mainClass}`;
                    }
                    return selector;
                }
                parent = parent.parentElement;
                depth++;
            }
            return "(no encontrado)";
        }

        function getFormInfo(el) {
            const form = el.closest('form');
            if (form) {
                return `action="${form.action || '(sin action)'}" method="${form.method || 'GET'}" id="${form.id || '(sin id)'}"`;
            }
            return "(no está en un formulario)";
        }

        function getDataAttributes(el) {
            const dataAttrs = {};
            for (const attr of el.attributes) {
                if (attr.name.startsWith('data-') && !attr.name.startsWith('data-ei-')) {
                    dataAttrs[attr.name] = attr.value;
                }
            }
            return Object.keys(dataAttrs).length > 0 ? JSON.stringify(dataAttrs, null, 2) : "(ninguno)";
        }

        const info = {
            "=== ELEMENTO ===": "",
            "Tag": element.tagName.toLowerCase(),
            "ID": element.id || "(sin id)",
            "Clases": element.className && typeof element.className === 'string'
                ? element.className.split(/\s+/).filter(c => c && !c.startsWith('ei-')).join(', ') || "(sin clases)"
                : "(sin clases)",
            "Name": element.name || "(sin name)",
            "Type": element.type || "(n/a)",
            "": "",
            "=== CONTEXTO ===": "",
            "Contenedor padre": getParentContainer(element),
            "Formulario": getFormInfo(element),
            "Hijos directos": element.children.length,
            " ": "",
            "=== EVENTOS ===": "",
            "Eventos inline": getInlineEvents(element),
            "  ": "",
            "=== DATA ATTRIBUTES ===": "",
            "Data attrs": getDataAttributes(element),
            "   ": "",
            "=== SELECTOR CSS ===": "",
            "Path": getElementPath(element),
            "    ": "",
            "=== ATRIBUTOS ===": "",
            "Atributos": JSON.stringify(getAttributes(element), null, 2),
            "     ": "",
            "=== CONTENIDO ===": "",
            "Texto": (element.textContent || "").trim().substring(0, 200) + ((element.textContent || "").length > 200 ? "..." : ""),
            "HTML interno": element.innerHTML.substring(0, 300) + (element.innerHTML.length > 300 ? "..." : ""),
            "      ": "",
            "=== POSICION Y TAMANO ===": "",
            "Dimensiones": `${Math.round(rect.width)}px x ${Math.round(rect.height)}px`,
            "Posicion": `top: ${Math.round(rect.top)}px, left: ${Math.round(rect.left)}px`,
            "Visible": computedStyle.display !== 'none' && computedStyle.visibility !== 'hidden' ? "Si" : "No",
            "       ": "",
            "=== ESTILOS COMPUTADOS ===": "",
            "Display": computedStyle.display,
            "Position": computedStyle.position,
            "Z-index": computedStyle.zIndex,
            "Background": computedStyle.backgroundColor,
            "Color": computedStyle.color,
            "Font": `${computedStyle.fontSize} ${computedStyle.fontFamily.split(',')[0]}`
        };

        let output = "/*\n * INFORMACION DEL ELEMENTO\n * Para usar con Claude Code\n */\n\n";

        for (const [key, value] of Object.entries(info)) {
            if (key.startsWith("===")) {
                output += `\n${key}\n`;
            } else if (key.trim() === "") {
                continue;
            } else {
                output += `${key}: ${value}\n`;
            }
        }

        output += "\n=== SELECTOR RECOMENDADO ===\n";
        if (element.id) {
            output += `#${element.id}\n`;
        } else if (element.className && typeof element.className === 'string') {
            const classes = element.className.trim().split(/\s+/).filter(c => c && !c.startsWith('ei-'));
            if (classes.length > 0) {
                output += `.${classes[0]}\n`;
            }
        }
        output += `\nPath completo: ${getElementPath(element)}\n`;

        return output;
    }

    // Evento de click derecho con Shift
    document.addEventListener('contextmenu', function(e) {
        if (e.shiftKey) {
            e.preventDefault();

            if (highlightedElement) {
                highlightedElement.classList.remove('ei-highlight');
            }

            const element = e.target;
            currentInfo = getElementInfo(element);

            element.classList.add('ei-highlight');
            highlightedElement = element;

            infoContainer.textContent = currentInfo;
            modal.style.display = 'flex';
        }
    });

    // Cerrar modal
    function closeModal() {
        modal.style.display = 'none';
        copyBtn.classList.remove('ei-copied');
        copyBtn.textContent = 'Copiar';

        if (highlightedElement) {
            highlightedElement.classList.remove('ei-highlight');
            highlightedElement = null;
        }
    }

    closeBtn.addEventListener('click', closeModal);
    closeX.addEventListener('click', closeModal);

    // Copiar información
    copyBtn.addEventListener('click', function() {
        navigator.clipboard.writeText(currentInfo).then(() => {
            copyBtn.classList.add('ei-copied');
            copyBtn.textContent = 'Copiado!';
            setTimeout(() => {
                copyBtn.classList.remove('ei-copied');
                copyBtn.textContent = 'Copiar';
            }, 2000);
        }).catch(err => {
            console.error('Error al copiar:', err);
            const textArea = document.createElement('textarea');
            textArea.value = currentInfo;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            copyBtn.classList.add('ei-copied');
            copyBtn.textContent = 'Copiado!';
        });
    });

    // Cerrar con Escape
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && modal.style.display === 'flex') {
            closeModal();
        }
    });

    console.log('[Element Inspector] Cargado. Usa Shift + Clic derecho para inspeccionar elementos.');
})();
