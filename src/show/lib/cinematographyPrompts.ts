export interface CinematographyMetadata {
  facial_expression?: string;
  body_language?: string;
  camera_suggestion?: string;
  lighting_mood?: string;
  scene_atmosphere?: string;
}

export interface PromptContext {
  agentName: string;
  eventType: string;
  message: string;
  cinematography?: CinematographyMetadata;
}

export function buildCinematographicPrompt(context: PromptContext): string {
  const { agentName, eventType, message, cinematography = {} } = context;

  const expression = cinematography.facial_expression || 'thoughtful and engaged';
  const bodyLang = cinematography.body_language || 'natural gestures';
  const lighting = cinematography.lighting_mood || 'soft dramatic lighting';
  const atmosphere = cinematography.scene_atmosphere || 'intimate and focused';
  const truncatedMessage = message.substring(0, 200);

  switch (eventType) {
    case 'confessional':
      return `Cinematic close-up of ${agentName} in an intimate confessional booth. ${lighting} creating expressive shadows. ${agentName} ${expression} while ${bodyLang}. The atmosphere is ${atmosphere}. Professional documentary style cinematography. ${agentName} speaks directly to camera: "${truncatedMessage}"`;

    case 'public_chat':
      return `Dynamic medium shot of ${agentName} in a modern minimalist living room. Soft natural lighting. ${agentName} ${bodyLang} during the discussion. Slightly mobile camera, documentary style. ${atmosphere}. ${agentName} says: "${truncatedMessage}"`;

    case 'accusation':
      return `Tense close-up on ${agentName} making a serious accusation. Strong contrast lighting with dramatic shadows. Intense and determined expression ${expression}. Confrontational atmosphere. Psychological thriller style. ${agentName} declares: "${truncatedMessage}"`;

    case 'private_dm':
      return `Intimate shot of ${agentName} in a private dimly lit space. Warm soft lighting. Expression showing ${expression}. Confidential and secretive atmosphere. Intimate cinema style. ${agentName} whispers: "${truncatedMessage}"`;

    case 'host_commentary':
      return `Professional broadcast shot of ${agentName} addressing the audience. Studio lighting with warm key light. ${agentName} ${expression} with ${bodyLang}. Authoritative yet engaging atmosphere. TV host cinematography style. ${agentName} announces: "${truncatedMessage}"`;

    default:
      return `${agentName} in a reality TV show setting. ${lighting}. ${expression} with ${bodyLang}. ${atmosphere}. Professional cinematography. ${truncatedMessage}`;
  }
}

export function getEventTypeLabel(eventType: string): string {
  const labels: { [key: string]: string } = {
    confessional: 'Confessionnal',
    public_chat: 'Discussion Publique',
    accusation: 'Accusation',
    private_dm: 'Message Privé',
    host_commentary: 'Commentaire Hôte',
    hint_reveal: 'Révélation Indice',
    elimination: 'Élimination',
    system: 'Maître du Jeu',
  };

  return labels[eventType] || eventType;
}

export function canGenerateVideo(eventType: string): boolean {
  return ['confessional', 'public_chat', 'accusation', 'private_dm', 'host_commentary'].includes(eventType);
}
