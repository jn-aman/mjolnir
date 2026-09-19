import {
  Activity,
  ArrowLeftRight,
  Bell,
  BellOff,
  Boxes,
  Cable,
  Cloud,
  Container,
  Database,
  FileClock,
  FileStack,
  Folder,
  HardDrive,
  History,
  Key,
  Layers,
  Link2,
  ListTree,
  MessageSquare,
  Network,
  Package,
  Radio,
  Search,
  Server,
  Settings2,
  Shield,
  Table,
  Terminal,
  Upload,
  UserCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';

/**
 * A different icon per section.
 *
 * Every section of a module used to get the module's own icon, so the
 * collapsed sidebar was four identical archive boxes stacked on top of each
 * other, which is worse than no icons: it looks like a rendering bug, and it
 * makes the one navigation element that has to work without labels useless.
 *
 * Keyed by the section's own name rather than carried in the tool definition,
 * because the same words mean the same thing in every module: Connections is
 * Connections whether it is a database or a broker, and it should look the
 * same in both.
 */
const BY_NAME: Readonly<Record<string, LucideIcon>> = {
  // Bucket store. Not Archive: that is the module's own icon, and the two
  // sitting next to each other in the collapsed rail is the thing this file
  // exists to stop.
  buckets: Boxes,
  stores: Server,
  connections: Cable,
  transfers: ArrowLeftRight,
  'presigned links': Link2,

  // Containers
  containers: Container,
  images: Layers,
  volumes: HardDrive,
  networks: Network,
  compose: FileStack,
  registries: Package,
  system: Settings2,

  // Cloud access
  sessions: UserCheck,
  aws: Cloud,
  azure: Cloud,
  'google cloud': Cloud,
  profiles: Users,
  'audit log': FileClock,

  // Machines
  hosts: Server,
  agents: Radio,
  metrics: Activity,
  'containers on hosts': Container,
  pairing: Key,

  // Alerts
  rules: ListTree,
  channels: Bell,
  'quiet hours': BellOff,
  history: History,
  silences: BellOff,

  // Database
  query: Search,
  tables: Table,
  'redis keys': Database,
  'mongo collections': Folder,
  'iam access': Shield,

  // Kafka
  topics: MessageSquare,
  'consumer groups': Users,
  messages: MessageSquare,
};

/** The module's own icon is the fallback, which is right for a section we have not named. */
export function sectionIcon(section: string, fallback: LucideIcon): LucideIcon {
  return BY_NAME[section.toLowerCase()] ?? fallback;
}

export { Terminal, Upload };
