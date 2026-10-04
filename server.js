import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Carregar variáveis de ambiente do .env local (apenas em ambiente de desenvolvimento)
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware para JSON e URL Encoded
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Importar os handlers da API
import ganhadorHandler from './api/ganhador.js';
import authCpfHandler from './api/auth-cpf.js';
import visitaHandler from './api/visita.js';
import sorteiosHandler from './api/sorteios.js';
import adminHandler from './api/admin/[action].js';
import payforgeHandler from './api/payforge/[action].js';

// Pagar.me handlers
import pagarmeHealth from './api/pagarme/health.js';
import pagarmePix from './api/pagarme/pix.js';
import pagarmeStatus from './api/pagarme/status.js';
import pagarmeWebhook from './api/pagarme/webhook.js';

// Timer: preenche telefone automaticamente via Serasa (cadastros sem telefone
// há mais de 10min, atribuídos a ligador ou não) — ver lib/telefoneAuto.js.
import { rodarTimerTelefoneAuto } from './lib/telefoneAuto.js';
import { iniciarTransmissao } from './lib/transmissao.js';

// Mapear rotas da API
app.all('/api/ganhador', ganhadorHandler);
app.all('/api/auth-cpf', authCpfHandler);
app.all('/api/visita', visitaHandler);
app.all('/api/sorteios', sorteiosHandler);

// Admin (Dynamic actions)
app.all('/api/admin/:action', (req, res) => {
  req.query = { ...req.query, action: req.params.action };
  adminHandler(req, res);
});

// PayForge (Dynamic actions)
app.all('/api/payforge/:action', (req, res) => {
  req.query = { ...req.query, action: req.params.action };
  payforgeHandler(req, res);
});

// Pagar.me
app.all('/api/pagarme/health', pagarmeHealth);
app.all('/api/pagarme/pix', pagarmePix);
app.all('/api/pagarme/status', pagarmeStatus);
app.all('/api/pagarme/webhook', pagarmeWebhook);

// Servir arquivos estáticos do frontend (pasta dist)
app.use(express.static(path.join(__dirname, 'dist')));

// Qualquer outra rota do frontend deve retornar o index.html (React Router SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const server = app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  rodarTimerTelefoneAuto();
});
iniciarTransmissao(server);
