// Crear menú contextual al instalar la extensión
chrome.runtime.onInstalled.addListener(() => {
  // Eliminar menús anteriores y crear nuevo
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "addToIsiPrime",
      title: "📥 Añadir a IsiPrime",
      contexts: ["page", "link", "video", "frame"]
    });
    console.log("IsiPrime Downloader: Menú contextual creado");
  });
});

// También crear el menú al iniciar (por si se recarga la extensión)
chrome.runtime.onStartup.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "addToIsiPrime",
      title: "📥 Añadir a IsiPrime",
      contexts: ["page", "link", "video", "frame"]
    });
  });
});

// Función para extraer el título del video de la página OK.ru
function extractVideoTitle() {
  // 1. Buscar el título del video debajo del reproductor (elemento principal en OK.ru)
  // El título aparece como texto grande debajo del video
  const videoTitleSelectors = [
    // Selectores específicos de OK.ru para el título del video
    'div.video-card_cnt div.video-card_n',
    'div.video-card_n',
    '.video-card_n-w',
    'div[class*="video-card"] div[class*="_n"]',
    '.vp-layer-info__title',
    // Buscar cualquier elemento que contenga el título visible
    'h1', 'h2',
    '[data-module="video"] h1',
    '.video-title',
    '.movie-title'
  ];

  for (const selector of videoTitleSelectors) {
    try {
      const elements = document.querySelectorAll(selector);
      for (const el of elements) {
        const text = (el.textContent || el.innerText || '').trim();
        // El título debe ser largo y no ser "OK" ni otros textos genéricos
        if (text && text.length > 5 &&
            text !== 'OK' &&
            !text.startsWith('Similar') &&
            !text.startsWith('Recommend') &&
            !text.includes('views')) {
          return text.split('\n')[0].trim(); // Solo la primera línea
        }
      }
    } catch(e) {}
  }

  // 2. Intentar meta og:title
  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle && ogTitle.getAttribute('content')) {
    const title = ogTitle.getAttribute('content').trim();
    if (title && title !== 'OK' && title.length > 3) {
      return title;
    }
  }

  // 3. Buscar en todo el body un texto que parezca título (fallback)
  const allText = document.body.innerText;
  const lines = allText.split('\n').map(l => l.trim()).filter(l => l.length > 10 && l.length < 200);
  for (const line of lines.slice(0, 20)) {
    if (!line.includes('views') && !line.includes('Share') && !line.startsWith('http')) {
      return line;
    }
  }

  return null;
}

// Manejar clic en el menú contextual
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "addToIsiPrime") {
    // Prioridad: srcUrl (video/imagen) > linkUrl > frameUrl > pageUrl
    const url = info.srcUrl || info.linkUrl || info.frameUrl || info.pageUrl;

    // Intentar extraer el título real del video desde la página
    let title = null;

    // Primero intentar extraer de la página (más confiable para OK.ru)
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractVideoTitle
      });
      if (results && results[0] && results[0].result) {
        title = results[0].result;
        console.log("Título extraído de la página:", title);
      }
    } catch (e) {
      console.log("No se pudo extraer título de la página:", e);
    }

    // Si no funcionó, intentar con el título de la pestaña
    if (!title && tab.title && tab.title.trim() !== 'OK' && tab.title.length > 5) {
      let cleanTitle = tab.title.replace(/\s*[-–|]\s*(OK\.RU|OK|Одноклассники).*$/i, '').trim();
      if (cleanTitle && cleanTitle.length > 3 && cleanTitle !== 'OK') {
        title = cleanTitle;
      }
    }

    // Si el título sigue siendo genérico, usar parte de la URL
    if (!title || title === 'OK' || title.length < 5) {
      const videoId = url.match(/video\/(\d+)/);
      title = videoId ? `OK.ru Video ${videoId[1]}` : url;
    }

    // Limitar longitud del título
    if (title && title.length > 100) {
      title = title.substring(0, 100) + '...';
    }

    try {
      const response = await fetch("http://localhost:9876/api/download-queue", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ url, title })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        // Mensaje de notificación
        let notifMessage = "✅ Añadido a cola de descargas";
        if (data.updatedRequest) {
          notifMessage = `✅ Descargando: ${data.updatedRequest.title}`;
        }

        // Mostrar notificación de éxito
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: showNotification,
            args: [notifMessage, "success"]
          });
        } catch (e) {
          console.log("Añadido correctamente (notificación no disponible en esta página)");
        }

        // Abrir IsiPrime o reutilizar pestaña existente
        try {
          // Buscar si ya hay una pestaña de IsiPrime abierta
          const tabs = await chrome.tabs.query({ url: "http://localhost:9876/*" });

          if (tabs.length > 0) {
            // Reutilizar la primera pestaña existente
            const existingTab = tabs[0];
            await chrome.tabs.update(existingTab.id, {
              url: "http://localhost:9876/?showRequests=true",
              active: true
            });
            // Enfocar la ventana que contiene la pestaña
            await chrome.windows.update(existingTab.windowId, { focused: true });
            console.log("IsiPrime: Reutilizando pestaña existente");
          } else {
            // Crear nueva pestaña solo si no existe ninguna
            await chrome.tabs.create({
              url: "http://localhost:9876/?showRequests=true",
              active: true
            });
            console.log("IsiPrime: Nueva pestaña creada");
          }

          // Cerrar la pestaña de OK.ru después de abrir IsiPrime
          await chrome.tabs.remove(tab.id);
          console.log("OK.ru: Pestaña cerrada");
        } catch (e) {
          console.log("No se pudo abrir IsiPrime:", e);
        }
      } else {
        // Mostrar error
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: showNotification,
            args: [data.error || "Error al añadir", "error"]
          });
        } catch (e) {
          console.error("Error:", data.error);
        }
      }
    } catch (error) {
      console.error("Error:", error);
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: showNotification,
          args: ["Error: IsiPrime no está ejecutándose", "error"]
        });
      } catch (e) {
        console.error("IsiPrime no está ejecutándose");
      }
    }
  }
});

// Función que se inyecta en la página para mostrar notificación
function showNotification(message, type) {
  // Eliminar notificación anterior si existe
  const existing = document.getElementById("isiprime-notification");
  if (existing) existing.remove();

  const notification = document.createElement("div");
  notification.id = "isiprime-notification";
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 16px 24px;
    border-radius: 8px;
    font-family: Arial, sans-serif;
    font-size: 14px;
    font-weight: bold;
    z-index: 999999;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    transition: opacity 0.3s;
    ${type === "success"
      ? "background: #10b981; color: white;"
      : "background: #ef4444; color: white;"}
  `;

  document.body.appendChild(notification);

  // Eliminar después de 3 segundos
  setTimeout(() => {
    notification.style.opacity = "0";
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}
