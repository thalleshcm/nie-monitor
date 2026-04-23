process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const TelegramBot = require('node-telegram-bot-api');
// Removed Axios imports

// Configurações do Telegram
const token = process.env.TELEGRAM_BOT_TOKEN || '8706451717:AAGDRgNsCpm1KbXcVInzT_4s8lngJV6TwWg';
const chatId = process.env.TELEGRAM_CHAT_ID || '5333937559';
const bot = new TelegramBot(token);

const DEFAULT_INTERVAL_MINUTES = 8;
const BLOCK_INTERVAL_MINUTES = 10;
const PROVINCE_NAME = 'Valencia';

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15'
];

async function randomDelay(min = 3000, max = 6000) {
    const ms = Math.floor(Math.random() * (max - min + 1)) + min;
    await new Promise(r => setTimeout(r, ms));
}

async function humanClick(page, selector) {
    console.log(`[Humano] Preparando para clicar em: ${selector}`);
    try {
        await page.evaluate(() => window.scrollBy(0, 200));
        await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
        
        const element = await page.$(selector);
        if (element) {
            const box = await element.boundingBox();
            if (box) {
                await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 });
                await new Promise(r => setTimeout(r, 500 + Math.random() * 1000));
            }
            await element.click();
        } else {
            console.log(`[Aviso] Elemento ${selector} não encontrado para clique humano.`);
        }
    } catch (e) {
        console.log(`[Aviso] Fallback para evaluate no clique humano de ${selector}: ${e.message}`);
        await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (el) el.click();
        }, selector);
    }
}

async function checkCitas() {
    console.log(`[${new Date().toISOString()}] Iniciando verificação de citas para ${PROVINCE_NAME}...`);
    let browser;
    let isBlockedError = false;

    try {
        browser = await puppeteer.launch({
            headless: true,
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath(),
            userDataDir: './user_data',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--disable-dev-shm-usage',
                '--disable-gpu'
            ]
        });
        const page = await browser.newPage();
        
        // Sorteia um User-Agent real
        const randomUA = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
        await page.setUserAgent(randomUA);
        
        // Adiciona headers para se assemelhar a um usuário normal
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'es-ES,es;q=0.9'
        });

        await page.setViewport({ width: 1280, height: 800 });
        page.setDefaultTimeout(60000);
        page.setDefaultNavigationTimeout(60000);

        console.log('Simulando comportamento humano: Acessando Google antes do portal...');
        await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, 2000));

        console.log('Acessando o portal de extranjería...');
        await page.goto('https://icp.administracionelectronica.gob.es/icpplus/index.html', { waitUntil: 'networkidle2', timeout: 60000 });

        await randomDelay(); // Delay simulando tempo de leitura

        // 1. Seleciona a Província
        console.log('Selecionando a província...');
        await page.waitForSelector('select#form');
        const provinceOptions = await page.$$eval('select#form option', options => options.map(o => ({ text: o.textContent.trim(), value: o.value })));
        const provinceOption = provinceOptions.find(o => o.text.includes(PROVINCE_NAME) || o.text.includes('València'));
        
        if (!provinceOption) {
            throw new Error(`Província ${PROVINCE_NAME} não encontrada no dropdown.`);
        }
        await page.select('select#form', provinceOption.value);
        
        await randomDelay(); // Delay antes de clicar
        await humanClick(page, 'input#btnAceptar');

        // 2. Seleciona o Trâmite
        console.log('Verificando se há tela de Trâmite...');
        await randomDelay(2000, 4000); // Espera pela transição
        
        // Debug removido
        
        let hasDropdown = false;
        try {
            await page.waitForSelector('select', { timeout: 3000 });
            hasDropdown = true;
            console.log('Dropdown encontrado na página.');
        } catch (e) {
            console.log('Nenhum dropdown encontrado após 3 segundos (fluxo direto ou trâmite único).');
        }

        if (hasDropdown) {
            const procedureSelects = await page.$$('select');
            let selectHandle = null;
            let selectId = null;
            
            for (const select of procedureSelects) {
                 const id = await page.evaluate(el => el.id, select);
                 if (id && id.includes('tramite')) {
                     selectHandle = select;
                     selectId = id;
                     break;
                 }
            }

            if (selectHandle && selectId) {
                 console.log(`Dropdown de trâmite detectado: select#${selectId}`);
                 const escapedId = selectId.replace(/\[/g, '\\[').replace(/\]/g, '\\]');
                 const procedureOptions = await page.$$eval(`select#${escapedId} option`, options => options.map(o => ({ text: o.textContent.trim(), value: o.value })));
                 
                 const targetProcedure = procedureOptions.find(o => {
                     const text = o.text.toUpperCase();
                     return text.includes('ASIGNACIÓN DE N.I.E.') || text.includes('ASIGNACIÓN DE NIE') || text.includes('ASIGNACION NIE');
                 });
                 
                 if (!targetProcedure) {
                     console.log('Aviso: Trâmite "ASIGNACIÓN DE NIE" não encontrado nesta província. O sistema pode ter bloqueado as opções.');
                 } else {
                     await page.select(`select#${escapedId}`, targetProcedure.value);
                 }
            } else {
                 console.log('Aviso: Nenhum select contém ID de "tramite". Prosseguindo...');
            }
        }

        await randomDelay();
        
        console.log('Buscando botão de continuar (Aceptar/Avançar)...');
        const selectorsAceptar = ['input#btnAceptar', 'button[id*="Aceptar"]', 'input[value="Aceptar"]', '#btnAceptar', 'input#btnEntrar', '.mf-button.primary'];
        let clickedAceptar = false;
        for (const selector of selectorsAceptar) {
            if (await page.$(selector)) {
                console.log(`Botão de continuar encontrado com seletor: ${selector}`);
                await humanClick(page, selector);
                clickedAceptar = true;
                break;
            }
        }
        
        if (!clickedAceptar) {
            console.log('⚠️ Botão Aceptar não encontrado após a província.');
        }

        await randomDelay(2000, 4000); // Espera carregamento da próxima tela

        // 3. Página de informações do trâmite
        console.log('Página de informações do trâmite...');
        
        console.log('Removendo banner de cookies se existir via JavaScript...');
        try {
            await page.evaluate(() => {
                const cookie = document.getElementById('cookie_action_close_header');
                if (cookie) cookie.click();
                // Remove o overlay de cookies se existir
                const overlay = document.querySelector('.cookie-banner, #cookies, .cookies-overlay, #cookie-law-info-bar');
                if (overlay) overlay.remove();
            });
        } catch (e) {
            console.log('Sem banner de cookies ou ignorado com sucesso.');
        }

        await randomDelay(1000, 2000);

        console.log('Clicando no botão Entrar via JavaScript...');
        try {
            await page.evaluate(() => {
                const btn = document.querySelector('input#btnEntrar');
                if (btn) btn.click();
            });
        } catch (e) {
            console.log('⚠️ Falha ao tentar clicar no botão btnEntrar.');
        }

        await randomDelay(3000, 4000); // Espera carregamento do formulário

        // Tenta preencher formulário se existir
        const hasForm = await page.$('input#txtIdCitado');
        if (hasForm) {
            console.log('Preenchendo dados do solicitante...');
            
            if (await page.$('input#rdbTipoDocPas')) {
                await page.click('input#rdbTipoDocPas');
            }
            
            await page.type('input#txtIdCitado', 'FY521816');
            
            if (await page.$('input#txtNombre')) {
                await page.type('input#txtNombre', 'Thalles henrique');
                if (await page.$('input#txtApellido1')) await page.type('input#txtApellido1', 'Cunha');
                if (await page.$('input#txtApellido2')) await page.type('input#txtApellido2', 'Martins');
            } else if (await page.$('input#txtDesCitado')) {
                await page.type('input#txtDesCitado', 'Thalles henrique Cunha Martins');
            }

            if (await page.$('input#txtAnnoCitado')) {
                await page.type('input#txtAnnoCitado', '1999');
            }
            
            if (await page.$('select#txtPaisNac')) {
                const countryOptions = await page.$$eval('select#txtPaisNac option', opts => opts.map(o => ({text: o.textContent, value: o.value})));
                const brazilOption = countryOptions.find(o => o.text.toUpperCase().includes('BRASIL'));
                if (brazilOption) {
                    await page.select('select#txtPaisNac', brazilOption.value);
                }
            }
            
            await randomDelay();
            
            // Debug removido

            // O botão de avançar geralmente é btnEnviar ou btnAceptar
            if (await page.$('input#btnEnviar')) {
                await humanClick(page, 'input#btnEnviar');
            } else if (await page.$('input#btnAceptar')) {
                await humanClick(page, 'input#btnAceptar');
            }
            
            await randomDelay(3000, 5000); // Espera a resposta final
        }

        console.log('Tentando clicar em Solicitar Cita...');
        const solicitarSelectors = ['input#btnEnviar', '#btnEnviar', 'input[value="Solicitar Cita"]', 'button[id*="Solicitar"]'];
        let clicouSolicitar = false;
        for (const sel of solicitarSelectors) {
             if (await page.$(sel)) {
                 await humanClick(page, sel);
                 clicouSolicitar = true;
                 console.log(`Clicado em Solicitar Cita através do seletor: ${sel}`);
                 break;
             }
        }

        if (clicouSolicitar) {
             await randomDelay(3000, 5000);
             // Debug removido
             
             // Aqui pode ser a tela de seleção de oficina (select#idSede) ou a tela "No hay citas"
             if (await page.$('select#idSede')) {
                 console.log('Tela de seleção de oficina encontrada. Selecionando a primeira oficina disponível...');
                 const sedeOptions = await page.$$eval('select#idSede option', opts => opts.map(o => o.value).filter(v => v && v !== ''));
                 if (sedeOptions.length > 0) {
                     await page.select('select#idSede', sedeOptions[0]);
                     await randomDelay();
                     if (await page.$('input#btnSiguiente')) {
                         await humanClick(page, 'input#btnSiguiente');
                     } else if (await page.$('input#btnEnviar')) {
                         await humanClick(page, 'input#btnEnviar');
                     }
                     await randomDelay(3000, 5000);
                 } else {
                     console.log('Nenhuma delegacia disponível no select.');
                 }
             }
        } else {
             console.log('Botão Solicitar Cita não encontrado. Pode já estar na tela de resultado ou bloqueio.');
        }

        console.log('Analisando o resultado final da página...');
        const pageText = await page.evaluate(() => document.body.innerText);
        
        const normalizedText = pageText.toLowerCase();

        const noCitas = normalizedText.includes('en este momento no hay citas disponibles') ||
                        normalizedText.includes('en este momento no hay citas') || 
                        normalizedText.includes('no hay citas disponibles') ||
                        normalizedText.includes('no hay suficientes citas disponibles') ||
                        normalizedText.includes('no existen citas') ||
                        normalizedText.includes('trámite no disponible');

        if (noCitas) {
            isBlockedError = 'OK'; // Sem vagas normais
        } else if (!noCitas && (normalizedText.includes('fecha') ||
                   normalizedText.includes('hora') ||
                   normalizedText.includes('calendario') ||
                   await page.$('.calendario') ||
                   await page.$('#idFechaHora'))) {
            console.log('✅ CITA DISPONÍVEL REAL! Calendário ou seletor de data apareceu.');
            await sendNotification('🚨 **CITA DISPONÍVEL!** 🚨\n\nO calendário ou opções de data/hora estão abertos!\nEntre agora: https://icp.administracionelectronica.gob.es/icpplus/index.html');
            isBlockedError = 'FOUND';
        } else {
            console.log('⚠️ Resultado inesperado na tela. A tela não informou "sem citas" nem mostrou calendário.');
            console.log('Alerta bloqueado para evitar falso positivo.');
            if (normalizedText.includes('requested url was rejected') || normalizedText.includes('support id')) {
                console.log('❌ WAF BLOCK DETECTADO NO PUPPETEER!');
                isBlockedError = 'WAF';
            } else {
                isBlockedError = 'ERROR';
            }
        }

    } catch (error) {
        console.error(`❌ Erro durante a verificação: ${error.message}`);
        
        // Verifica se o erro indica um bloqueio de conexão
        if (error.message.includes('ERR_CONNECTION_TIMED_OUT') || 
            error.message.includes('ERR_CONNECTION_REFUSED') ||
            error.message.includes('ERR_NAME_NOT_RESOLVED') ||
            error.message.includes('Navigation timeout')) {
            isBlockedError = 'BLOCKED';
            console.log('⚠️ Possível bloqueio de IP detectado pelo firewall. Aumentando o tempo de espera da próxima iteração...');
        } else {
            isBlockedError = 'ERROR';
        }
    } finally {
        if (browser) {
            await browser.close();
        }
    }

    return isBlockedError || 'OK';
}

// Fallback Axios removido

async function sendNotification(message) {
    try {
        await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        console.log('Notificação Telegram enviada com sucesso.');
    } catch (error) {
        console.error('Erro ao enviar notificação no Telegram:', error.message);
    }
}

// Loop dinâmico usando Async/Await em vez de setInterval
async function startMonitor() {
    console.log('=== Monitor de NIE Iniciado ===');
    console.log(`Província: ${PROVINCE_NAME}`);
    console.log(`Delay Humano Ativo: Entre 3.0s e 6.0s por ação`);
    console.log('===============================\n');

    while (true) {
        let status = await checkCitas();
        
        // Se foi bloqueado aguarda 10 minutos, senão o normal (8 minutos)
        const minutesToWait = (status === 'BLOCKED' || status === 'ERROR' || status === 'WAF') ? BLOCK_INTERVAL_MINUTES : DEFAULT_INTERVAL_MINUTES;
        
        const now = new Date();
        const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
        
        if (status === 'OK') {
            console.log(`[${timeStr}] ❌ Sem vagas disponíveis. Próxima tentativa em ${minutesToWait} minutos.`);
        } else if (status === 'FOUND') {
            console.log(`[${timeStr}] 🎉 Vagas encontradas! Próxima tentativa em ${minutesToWait} minutos.`);
        } else {
            console.log(`[${timeStr}] ⚠️ Tentativa abortada com status ${status}. Próxima tentativa em ${minutesToWait} minutos.`);
        }
        
        // Espera o tempo especificado
        await new Promise(resolve => setTimeout(resolve, minutesToWait * 60 * 1000));
    }
}

startMonitor();
