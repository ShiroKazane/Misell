const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  ComponentType,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const { kickTarget } = require("@helpers/ModUtils");
const { getSettings } = require("@schemas/Guild");
const { EMBED_COLORS } = require("@root/config");

/**
 * @param {string} content
 * @param {import('discord.js').GuildMember} member
 * @param {Object} inviterData
 */
const parse = async (content, member, inviterData = {}) => {
  const inviteData = {};

  const getEffectiveInvites = (inviteData = {}) =>
    inviteData.tracked + inviteData.added - inviteData.fake - inviteData.left || 0;

  if (content.includes("{inviter:")) {
    const inviterId = inviterData.member_id || "NA";
    if (inviterId !== "VANITY" && inviterId !== "NA") {
      try {
        const inviter = await member.client.users.fetch(inviterId);
        inviteData.name = inviter.username;
        inviteData.tag = inviter.tag;
      } catch (ex) {
        member.client.logger.error(`Parsing inviterId: ${inviterId}`, ex);
        inviteData.name = "NA";
        inviteData.tag = "NA";
      }
    } else if (member.user.bot) {
      inviteData.name = "OAuth";
      inviteData.tag = "OAuth";
    } else {
      inviteData.name = inviterId;
      inviteData.tag = inviterId;
    }
  }
  return content
    .replaceAll(/\\n/g, "\n")
    .replaceAll(/{server}/g, member.guild.name)
    .replaceAll(/{count}/g, member.guild.memberCount)
    .replaceAll(/{member:nick}/g, member.displayName)
    .replaceAll(/{member:name}/g, member.user.username)
    .replaceAll(/{member:dis}/g, member.user.discriminator)
    .replaceAll(/{member:tag}/g, member.user.tag)
    .replaceAll(/{member:mention}/g, member.toString())
    .replaceAll(/{member:avatar}/g, member.displayAvatarURL())
    .replaceAll(/{inviter:name}/g, inviteData.name)
    .replaceAll(/{inviter:tag}/g, inviteData.tag)
    .replaceAll(/{invites}/g, getEffectiveInvites(inviterData.invite_data));
};

/**
 * @param {import('discord.js').GuildMember} member
 * @param {"WELCOME"|"FAREWELL"} type
 * @param {Object} config
 * @param {Object} inviterData
 */
const buildGreeting = async (member, type, config, inviterData) => {
  if (!config) return;
  let content;

  // build content
  if (config.content) content = await parse(config.content, member, inviterData);

  // build embed
  const embed = new EmbedBuilder();
  if (config.embed.description) {
    const parsed = await parse(config.embed.description, member, inviterData);
    embed.setDescription(parsed);
  }
  if (config.embed.color) embed.setColor(config.embed.color);
  if (config.embed.thumbnail) embed.setThumbnail(member.user.displayAvatarURL());
  if (config.embed.footer) {
    const parsed = await parse(config.embed.footer, member, inviterData);
    embed.setFooter({ text: parsed });
  }
  if (config.embed.image) {
    const parsed = await parse(config.embed.image, member);
    embed.setImage(parsed);
  }

  // set default message
  if (!config.content && !config.embed.description && !config.embed.footer) {
    content =
      type === "WELCOME"
        ? `Welcome to the server, ${member.displayName} 🎉`
        : `${member.user.username} has left the server 👋`;
    return { content };
  }

  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("welcome").setLabel("Verify").setStyle(ButtonStyle.Primary)
  );

  return { content, embeds: [embed], components: [buttonRow] };
};

/**
 * Send welcome message
 * @param {import('discord.js').GuildMember} member
 * @param {Object} inviterData
 */
async function sendWelcome(member, inviterData = {}) {
  const config = (await getSettings(member.guild))?.welcome;
  if (!config || !config.enabled) return;

  // check if channel exists
  const channel = member.guild.channels.cache.get(config.channel);
  if (!channel) return;

  // build welcome message
  const response = await buildGreeting(member, "WELCOME", config, inviterData);

  const sentMsg = await channel.safeSend(response);

  if (!sentMsg) return;

  const btnInteraction = await channel
    .awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (i) => i.customId === "welcome" && i.member.id === member.id && i.message.id === sentMsg.id,
      time: 1_200_000,
    })
    .catch((e) => {});

  if (!btnInteraction) return member.kick("Still not verified after 20 minutes");

  await btnInteraction.showModal(
    new ModalBuilder({
      customId: "welcome-modal",
      title: "GrowID Verification",
      components: [
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("growid")
            .setLabel("What is your GrowID?")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        ),
      ],
    })
  );

  const modal = await btnInteraction
    .awaitModalSubmit({
      time: 1_200_000,
      filter: (m) => m.customId === "welcome-modal" && m.member.id === member.id && m.message.id === sentMsg.id,
    })
    .catch((ex) => {});

  if (!modal) return member.kick("Still not verified after 20 minutes");

  await modal.reply({ content: "Please wait for a review from our server administrator.", ephemeral: true });

  const growid = modal.fields.getTextInputValue("growid");

  const verifyChannel = member.guild.channels.cache.get("1161593330128396328")

  const verifyButton = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("member-confirm").setEmoji("🏙️").setStyle(ButtonStyle.Secondary)
  );

  const verify = await verifyChannel.safeSend({
    content: "<@&11615711383930880001161571138393088000>",
    embeds: [
      {
        color: 0xdddddd,
        author: {
          name: "Verification Request",
        },
        thumbnail: member.avatarURL(),
        description: "If the GrowID is the GrowID of one of the City Guild members then\npress 🏙️, otherwise leave it.",
        fields: [
          {
            name: "Requested by",
            value: `<@!${member.id}>`,
            inline: true,
          },
          {
            name: "GrowID",
            value: growid,
            inline: true,
          },
        ],
        timestamp: new Date().toISOString(),
      },
    ],
    components: [verifyButton],
  });

  if (!verify) return;

  const verifyInteraction = await verifyChannel
    .awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (m) => m.customId === "member-confirm",
      time: 1_200_000,
    })
    .catch((e) => {});

  if (!verifyInteraction) return member.setNickname(growid).catch((err) => {});

  await verifyInteraction.reply({ content: `<@!${member.user.id}> already comfirmed as <@&1161571138393088000>.`, ephemeral: true });
  await member.roles.add("1161571138393088000").catch((err) => {});
  await member.roles.remove("1161575433704325251").catch((err) => {});
  await member.setNickname(growid).catch((err) => {});
}

/**
 * Send farewell message
 * @param {import('discord.js').GuildMember} member
 * @param {Object} inviterData
 */
async function sendFarewell(member, inviterData = {}) {
  const config = (await getSettings(member.guild))?.farewell;
  if (!config || !config.enabled) return;

  // check if channel exists
  const channel = member.guild.channels.cache.get(config.channel);
  if (!channel) return;

  // build farewell message
  const response = await buildGreeting(member, "FAREWELL", config, inviterData);

  channel.safeSend(response);
}

module.exports = {
  buildGreeting,
  sendWelcome,
  sendFarewell,






};