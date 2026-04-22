type EventImageRule = {
  keywords: string[];
  image_url: string;
};

const EVENT_IMAGE_RULES: EventImageRule[] = [
  {
    keywords: ["flood", "rescue", "evacuation", "water"],
    image_url:
      "https://images.unsplash.com/photo-1500375592092-40eb2168fd21?auto=format&fit=crop&w=1200&q=80",
  },
  {
    keywords: ["earthquake", "debris", "disaster"],
    image_url:
      "https://images.unsplash.com/photo-1473448912268-2022ce9509d8?auto=format&fit=crop&w=1200&q=80",
  },
  {
    keywords: ["food", "ration", "meal", "kitchen", "distribution"],
    image_url:
      "https://images.unsplash.com/photo-1488521787991-ed7bbaae773c?auto=format&fit=crop&w=1200&q=80",
  },
  {
    keywords: ["animal", "pet", "wildlife", "veterinary"],
    image_url:
      "https://images.unsplash.com/photo-1450778869180-41d0601e046e?auto=format&fit=crop&w=1200&q=80",
  },
  {
    keywords: ["medical", "doctor", "nurse", "camp", "triage"],
    image_url:
      "https://images.unsplash.com/photo-1584515933487-779824d29309?auto=format&fit=crop&w=1200&q=80",
  },
  {
    keywords: ["shelter", "camp", "tent", "relief"],
    image_url:
      "https://images.unsplash.com/photo-1511895426328-dc8714191300?auto=format&fit=crop&w=1200&q=80",
  },
  {
    keywords: ["education", "children", "learning", "school"],
    image_url:
      "https://images.unsplash.com/photo-1503676260728-1c00da094a0b?auto=format&fit=crop&w=1200&q=80",
  },
];

const DEFAULT_EVENT_IMAGE =
  "https://images.unsplash.com/photo-1521737604893-d14cc237f11d?auto=format&fit=crop&w=1200&q=80";

export function getNeedCardImage(
  needType: string,
  title: string,
  description: string = "",
): string {
  const text = `${needType} ${title} ${description}`.toLowerCase();
  for (const rule of EVENT_IMAGE_RULES) {
    if (rule.keywords.some((keyword) => text.includes(keyword))) {
      return rule.image_url;
    }
  }
  return DEFAULT_EVENT_IMAGE;
}
