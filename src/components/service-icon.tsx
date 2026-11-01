import {
  AirVent,
  AppWindow,
  Baby,
  Bug,
  Car,
  CarFront,
  ChefHat,
  Dog,
  Droplets,
  Dumbbell,
  Flower2,
  GraduationCap,
  HeartHandshake,
  Music,
  PawPrint,
  Scissors,
  ShieldCheck,
  Shirt,
  Sofa,
  Sparkles,
  Waves,
  Zap,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  cleaning: Sparkles,
  tutoring: GraduationCap,
  "dog-walking": Dog,
  "pool-cleaning": Waves,
  upholstery: Sofa,
  "security-check": ShieldCheck,
  "car-servicing": Car,
  gardening: Flower2,
  laundry: Shirt,
  "window-cleaning": AppWindow,
  "pest-control": Bug,
  "ac-servicing": AirVent,
  generator: Zap,
  "water-tank": Droplets,
  "car-wash": CarFront,
  "personal-trainer": Dumbbell,
  barber: Scissors,
  "pet-grooming": PawPrint,
  lessons: Music,
  babysitting: Baby,
  "elderly-care": HeartHandshake,
  "meal-prep": ChefHat,
};

/** Category tints: soft pastel clay per area of life. */
export const CATEGORY_TINT: Record<string, string> = {
  Home: "linear-gradient(145deg,#ffe6d6,#f9c9a8)",
  Family: "linear-gradient(145deg,#ebe3ff,#cfc0f5)",
  Pets: "linear-gradient(145deg,#dcf5ea,#b4e3cd)",
  Vehicle: "linear-gradient(145deg,#ddefff,#b5d6f5)",
  Wellness: "linear-gradient(145deg,#ffe0ea,#f5b9cb)",
};

export function ServiceIcon({ id, size = 20 }: { id: string; size?: number }) {
  const Icon = ICONS[id] ?? Sparkles;
  return <Icon size={size} aria-hidden />;
}
