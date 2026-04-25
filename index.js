require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");

const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("./database.sqlite");

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const acoesAtivas = new Map();
const ITENS_POR_PAGINA = 10;

db.run(`
CREATE TABLE IF NOT EXISTS acoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  acaoId TEXT,
  nomeAcao TEXT,
  userId TEXT,
  username TEXT,
  dinheiro INTEGER,
  inicio INTEGER,
  fim INTEGER,
  tempo INTEGER,
  createdAt INTEGER
)
`);

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
  });
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      err ? reject(err) : resolve(this);
    });
  });
}

function formatarTempo(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}h ${m}m ${sec}s`;
}

function inicioSemana() {
  const d = new Date();
  const dia = d.getDay();
  const diff = d.getDate() - dia + (dia === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function inicioMes() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function montarEmbedAcao(acao) {
  const agora = Date.now();

  const lista = [...acao.participantes.values()].map(p => {
    const tempo = p.saiu ? p.tempo : p.tempo + agora - p.entrada;
    const status = p.saiu ? "❌ Saiu" : "✅ Ativo";
    return `• <@${p.userId}> — ${status} — ${formatarTempo(tempo)}`;
  }).join("\n") || "Nenhum participante ainda.";

  return new EmbedBuilder()
    .setColor("#5865F2")
    .setTitle(`🎯 Ação: ${acao.nome}`)
    .setDescription(
      `👤 **Criador:** <@${acao.criadorId}>\n` +
      `💰 **Dinheiro acumulado:** R$ ${acao.dinheiroTotal.toLocaleString("pt-BR")}\n` +
      `👥 **Participantes:** ${acao.participantes.size}\n\n` +
      `**Lista de participantes:**\n${lista}`
    );
}

function criarBotoesAcao(acao) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`entrar_${acao.id}`)
      .setLabel("Entrar")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId(`sair_${acao.id}`)
      .setLabel("Sair")
      .setEmoji("🚪")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId(`add_${acao.id}`)
      .setLabel("Adicionar Dinheiro")
      .setEmoji("💰")
      .setStyle(ButtonStyle.Primary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`participantes_${acao.id}`)
      .setLabel("Atualizar")
      .setEmoji("🔄")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId(`finalizar_${acao.id}`)
      .setLabel("Finalizar")
      .setEmoji("🏁")
      .setStyle(ButtonStyle.Danger)
  );

  return [row1, row2];
}

function criarPainelAcao(acao) {
  return {
    embeds: [montarEmbedAcao(acao)],
    components: criarBotoesAcao(acao)
  };
}

async function atualizarPainelAcao(acao) {
  try {
    if (!acao.channelId || !acao.messageId) return;

    const channel = await client.channels.fetch(acao.channelId);
    const message = await channel.messages.fetch(acao.messageId);

    await message.edit({
      embeds: [montarEmbedAcao(acao)],
      components: criarBotoesAcao(acao)
    });
  } catch (err) {
    console.error("Erro ao atualizar painel:", err);
  }
}

async function gerarRanking(tipo, pagina = 0) {
  let filtro = "";
  let titulo = "🌎 Ranking Geral";
  const params = [];

  if (tipo === "semanal") {
    filtro = "WHERE createdAt >= ?";
    params.push(inicioSemana());
    titulo = "📅 Ranking Semanal";
  }

  if (tipo === "mensal") {
    filtro = "WHERE createdAt >= ?";
    params.push(inicioMes());
    titulo = "🏆 Ranking Mensal";
  }

  const ranking = await dbAll(`
    SELECT 
      userId,
      username,
      COUNT(*) as totalAcoes,
      SUM(dinheiro) as totalDinheiro,
      SUM(tempo) as totalTempo
    FROM acoes
    ${filtro}
    GROUP BY userId
    ORDER BY totalDinheiro DESC, totalTempo DESC
  `, params);

  const totalPaginas = Math.max(Math.ceil(ranking.length / ITENS_POR_PAGINA), 1);
  pagina = Math.max(0, Math.min(pagina, totalPaginas - 1));

  const inicio = pagina * ITENS_POR_PAGINA;
  const paginaAtual = ranking.slice(inicio, inicio + ITENS_POR_PAGINA);

  const descricao = paginaAtual.length
    ? paginaAtual.map((r, i) => {
        const pos = inicio + i + 1;
        return `**${pos}. ${r.username}** — 💰 R$ ${Number(r.totalDinheiro || 0).toLocaleString("pt-BR")} | ⏱️ ${formatarTempo(Number(r.totalTempo || 0))} | 🎯 ${r.totalAcoes}`;
      }).join("\n")
    : "Nenhum dado encontrado.";

  const embed = new EmbedBuilder()
    .setColor("#F1C40F")
    .setTitle(titulo)
    .setDescription(descricao)
    .addFields({
      name: "Legenda",
      value: "💰 Dinheiro | ⏱️ Tempo | 🎯 Ações"
    })
    .setFooter({ text: `Página ${pagina + 1}/${totalPaginas}` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rank_prev_${tipo}_${pagina}`)
      .setLabel("Anterior")
      .setEmoji("⬅️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(pagina <= 0),

    new ButtonBuilder()
      .setCustomId(`rank_next_${tipo}_${pagina}`)
      .setLabel("Próximo")
      .setEmoji("➡️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(pagina >= totalPaginas - 1)
  );

  return {
    embeds: [embed],
    components: [row],
    ephemeral: true
  };
}

async function enviarLogFinal(acao, participantes, lista, tempoTotal) {
  try {
    if (!process.env.LOG_CHANNEL_ID) return;

    const canalLogs = await client.channels.fetch(process.env.LOG_CHANNEL_ID).catch(() => null);
    if (!canalLogs) return;

    const embedLog = new EmbedBuilder()
      .setColor("#2ECC71")
      .setTitle("📋 Relatório Final da Ação")
      .setDescription(
        `🎯 **Ação:** ${acao.nome}\n` +
        `👤 **Criador:** <@${acao.criadorId}>\n` +
        `💰 **Dinheiro total:** R$ ${acao.dinheiroTotal.toLocaleString("pt-BR")}\n` +
        `⏱️ **Duração total:** ${formatarTempo(tempoTotal)}\n` +
        `👥 **Total de participantes:** ${participantes.length}`
      )
      .addFields({
        name: "Participantes",
        value: lista || "Nenhum participante"
      })
      .setFooter({
        text: "Relatório enviado automaticamente"
      })
      .setTimestamp();

    await canalLogs.send({ embeds: [embedLog] });
  } catch (err) {
    console.error("Erro ao enviar log final:", err);
  }
}

const commands = [
  new SlashCommandBuilder()
    .setName("acao")
    .setDescription("Cria uma nova ação")
    .addStringOption(option =>
      option
        .setName("nome")
        .setDescription("Nome da ação")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("ranking")
    .setDescription("Mostra o ranking")
    .addStringOption(option =>
      option
        .setName("tipo")
        .setDescription("Tipo do ranking")
        .setRequired(true)
        .addChoices(
          { name: "Geral", value: "geral" },
          { name: "Semanal", value: "semanal" },
          { name: "Mensal", value: "mensal" }
        )
    ),

  new SlashCommandBuilder()
    .setName("resumo")
    .setDescription("Mostra seu resumo pessoal")
];

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

async function registrarComandos() {
  try {
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );

    console.log("✅ Comandos registrados.");
  } catch (err) {
    console.error("Erro ao registrar comandos:", err);
  }
}

client.once("ready", () => {
  console.log(`✅ Bot online como ${client.user.tag}`);
});

client.on("interactionCreate", async interaction => {
  try {
    const user = interaction.user;

    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "acao") {
        const nome = interaction.options.getString("nome");
        const id = Date.now().toString();

        const acao = {
  id,
  nome,
  criadorId: user.id,
  criadorUsername: user.username,
  inicio: Date.now(),
  dinheiroTotal: 0,
  participantes: new Map()
};

// Criador já entra automaticamente na ação
acao.participantes.set(user.id, {
  userId: user.id,
  username: user.username,
  entrada: Date.now(),
  tempo: 0,
  saiu: false
});

acoesAtivas.set(id, acao);

        const msg = await interaction.reply({
          ...criarPainelAcao(acao),
          fetchReply: true
        });

        acao.messageId = msg.id;
        acao.channelId = msg.channel.id;

        acoesAtivas.set(id, acao);
        return;
      }

      if (interaction.commandName === "ranking") {
        const tipo = interaction.options.getString("tipo");
        return interaction.reply(await gerarRanking(tipo, 0));
      }

      if (interaction.commandName === "resumo") {
        const dados = await dbGet(`
          SELECT 
            COUNT(*) as totalAcoes,
            SUM(dinheiro) as totalDinheiro,
            SUM(tempo) as totalTempo
          FROM acoes
          WHERE userId = ?
        `, [user.id]);

        const embed = new EmbedBuilder()
          .setColor("#3498DB")
          .setTitle("📊 Meu Resumo")
          .setDescription(`${user}`)
          .addFields(
            {
              name: "🎯 Ações participadas",
              value: `${dados?.totalAcoes || 0}`,
              inline: true
            },
            {
              name: "💰 Dinheiro sujo",
              value: `R$ ${Number(dados?.totalDinheiro || 0).toLocaleString("pt-BR")}`,
              inline: true
            },
            {
              name: "⏱️ Tempo total",
              value: formatarTempo(Number(dados?.totalTempo || 0)),
              inline: true
            }
          );

        return interaction.reply({
          embeds: [embed],
          ephemeral: true
        });
      }
    }

    if (interaction.isButton()) {
      if (interaction.customId.startsWith("rank_prev_")) {
        const partes = interaction.customId.split("_");
        return interaction.update(await gerarRanking(partes[2], Number(partes[3]) - 1));
      }

      if (interaction.customId.startsWith("rank_next_")) {
        const partes = interaction.customId.split("_");
        return interaction.update(await gerarRanking(partes[2], Number(partes[3]) + 1));
      }

      const acaoId = interaction.customId.split("_")[1];
      const acao = acoesAtivas.get(acaoId);

      if (!acao) {
        return interaction.reply({
          content: "❌ Essa ação não está mais ativa.",
          ephemeral: true
        });
      }

      if (interaction.customId.startsWith("entrar_")) {
        const participanteAntigo = acao.participantes.get(user.id);

        if (participanteAntigo && !participanteAntigo.saiu) {
          return interaction.reply({
            content: "❌ Você já está participando dessa ação.",
            ephemeral: true
          });
        }

        acao.participantes.set(user.id, {
          userId: user.id,
          username: user.username,
          entrada: Date.now(),
          tempo: participanteAntigo?.tempo || 0,
          saiu: false
        });

        await atualizarPainelAcao(acao);

        return interaction.reply({
          content: `✅ Você entrou na ação **${acao.nome}**.`,
          ephemeral: true
        });
      }

      if (interaction.customId.startsWith("sair_")) {
        const participante = acao.participantes.get(user.id);

        if (!participante || participante.saiu) {
          return interaction.reply({
            content: "❌ Você não está participando dessa ação.",
            ephemeral: true
          });
        }

        participante.tempo += Date.now() - participante.entrada;
        participante.saiu = true;
        participante.saida = Date.now();

        acao.participantes.set(user.id, participante);

        await atualizarPainelAcao(acao);

        return interaction.reply({
          content: `🚪 Você saiu da ação **${acao.nome}**.`,
          ephemeral: true
        });
      }

      if (interaction.customId.startsWith("add_")) {
        const modal = new ModalBuilder()
          .setCustomId(`modal_add_${acaoId}`)
          .setTitle("Adicionar Dinheiro");

        const input = new TextInputBuilder()
          .setCustomId("valor")
          .setLabel("Valor do dinheiro sujo")
          .setPlaceholder("Exemplo: 50000")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
      }

      if (interaction.customId.startsWith("participantes_")) {
        await atualizarPainelAcao(acao);

        return interaction.reply({
          content: "✅ Ação atualizada.",
          ephemeral: true
        });
      }

      if (interaction.customId.startsWith("finalizar_")) {
        const participante = acao.participantes.get(user.id);

        if (!participante) {
          return interaction.reply({
            content: "❌ Você precisa estar participando da ação para finalizar.",
            ephemeral: true
          });
        }

        if (participante.saiu) {
          return interaction.reply({
            content: "❌ Você saiu da ação e não pode finalizá-la.",
            ephemeral: true
          });
        }

        if (acao.participantes.size === 0) {
          return interaction.reply({
            content: "❌ Não é possível finalizar sem participantes.",
            ephemeral: true
          });
        }

        const fim = Date.now();
        const tempoTotal = fim - acao.inicio;
        const participantes = [...acao.participantes.values()];

        for (const p of participantes) {
          let tempoFinal = p.tempo;

          if (!p.saiu) {
            tempoFinal += fim - p.entrada;
          }

          await dbRun(`
            INSERT INTO acoes
            (acaoId, nomeAcao, userId, username, dinheiro, inicio, fim, tempo, createdAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            acao.id,
            acao.nome,
            p.userId,
            p.username,
            acao.dinheiroTotal,
            acao.inicio,
            fim,
            tempoFinal,
            Date.now()
          ]);
        }

        const lista = participantes.map(p => {
          const tempoFinal = p.saiu ? p.tempo : p.tempo + fim - p.entrada;
          const status = p.saiu ? "Saiu" : "Ativo até o final";
          return `• <@${p.userId}> — ${status} — ${formatarTempo(tempoFinal)}`;
        }).join("\n");

        const embedFinal = new EmbedBuilder()
          .setColor("#2ECC71")
          .setTitle(`✅ Ação Finalizada: ${acao.nome}`)
          .setDescription(
            `👤 **Criador:** <@${acao.criadorId}>\n` +
            `💰 **Dinheiro total:** R$ ${acao.dinheiroTotal.toLocaleString("pt-BR")}\n` +
            `⏱️ **Duração total:** ${formatarTempo(tempoTotal)}\n` +
            `👥 **Participantes:** ${participantes.length}`
          )
          .addFields({
            name: "Relatório dos participantes",
            value: lista || "Nenhum participante"
          })
          .setFooter({
            text: "Ação encerrada — painel desativado"
          })
          .setTimestamp();

        await enviarLogFinal(acao, participantes, lista, tempoTotal);

        acoesAtivas.delete(acao.id);

        try {
          if (acao.channelId && acao.messageId) {
            const channel = await client.channels.fetch(acao.channelId);
            const message = await channel.messages.fetch(acao.messageId);

            await message.edit({
              embeds: [embedFinal],
              components: []
            });
          }
        } catch (err) {
          console.error("Erro ao editar relatório final:", err);
        }

        return interaction.reply({
          content: `✅ Ação **${acao.nome}** finalizada. O painel foi substituído pelo relatório final.`,
          ephemeral: true
        });
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith("modal_add_")) {
        const acaoId = interaction.customId.replace("modal_add_", "");
        const acao = acoesAtivas.get(acaoId);

        if (!acao) {
          return interaction.reply({
            content: "❌ Essa ação não está mais ativa.",
            ephemeral: true
          });
        }

        const valorTexto = interaction.fields.getTextInputValue("valor");
        const valor = Number(valorTexto.replace(/\D/g, ""));

        if (!valor || valor <= 0) {
          return interaction.reply({
            content: "❌ Valor inválido.",
            ephemeral: true
          });
        }

        acao.dinheiroTotal += valor;
        acoesAtivas.set(acaoId, acao);

        await atualizarPainelAcao(acao);

        return interaction.reply({
          content: `💰 Adicionado **R$ ${valor.toLocaleString("pt-BR")}** na ação **${acao.nome}**.`,
          ephemeral: true
        });
      }
    }
  } catch (err) {
    console.error(err);

    if (!interaction.replied && !interaction.deferred) {
      return interaction.reply({
        content: "❌ Ocorreu um erro ao executar essa ação.",
        ephemeral: true
      });
    }
  }
});

registrarComandos();
client.login(process.env.TOKEN);