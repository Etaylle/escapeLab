export {
  parseMission,
  checkMission,
  missionSchema,
  DECOR_KINDS,
  DECOR_VARIANTS,
  MANUAL_KINDS,
  MAX_LAMPS,
  ROOM_KINDS,
  type DecorKind,
  type ManualKind,
  type Mission,
  type MissionCheck,
  type RoomKind,
} from './mission.js';
export { decorTiles, walkable } from './reach.js';
export { MAX_NOTES, NOTE_TEXT_MAX, noteKey, noteSpot } from './notes.js';
export {
  initialState,
  CREW_COLORS,
  NO_CREDITS,
  type Credits,
  type GameState,
  type ItemState,
  type Player,
  type Phase,
  type Presence,
  type RunEvent,
} from './state.js';
export {
  applyAction,
  inEscapePhase,
  missingItemsFor,
  NOTE_READ,
  POWER_OUT,
  puzzleDueAt,
  type Action,
} from './actions.js';
export { runReport, type RunOutcome, type RunReport, type StationReport } from './report.js';
export type {
  DifficultyStats,
  LeaderEntry,
  MissionStanding,
  MissionStats,
  RunPlace,
} from './runStats.js';
export { GameError } from './errors.js';
export {
  viewFor,
  viewForSpectator,
  type SpectatorView,
  type PlayerView,
  type Lights,
  type PlayerPresence,
  type ManualHere,
  type NoteHere,
  type SourceHere,
  type MapView,
  type Grade,
} from './view.js';
export {
  MODULES,
  moduleFor,
  puzzleDefSchema,
  type PuzzleDef,
  type PuzzleState,
  type PuzzleInput,
  type PuzzleInputOf,
  type PuzzleView,
} from './puzzles/index.js';
export type {
  ApplyResult,
  ConsoleId,
  EmergencyModule,
  FieldSpec,
  ManualBlock,
  ManualSection,
  Move,
  Perspectives,
  PuzzleContext,
  PuzzleDefCommon,
  PuzzleModule,
  PuzzleViewCommon,
  SolveAid,
  Viewer,
  ViewContext,
} from './puzzles/module.js';
export {
  generateEdgework,
  indicatorLit,
  indicatorPresent,
  serialHasVowel,
  serialLastDigit,
  serialLastDigitIsOdd,
  INDICATOR_IDS,
  type Edgework,
  type IndicatorId,
} from './edgework.js';
export {
  doorOpen,
  platePressed,
  shutDoors,
  stepAllowed,
  armedStations,
  lightsAreOut,
  patrollingDrones,
  emergenciesDue,
  consoleOf,
  operatorsOf,
  readersOf,
  stationKey,
} from './map.js';
export { canSee, sightFrom, visibleTiles, type Sight, type SightMap } from './sight.js';
export { type MapDef } from './mission.js';
export {
  parseClientMessage,
  clientMessageSchema,
  rtcSignalSchema,
  RTC_SIGNAL_MAX,
  SEED_MAX,
  isCustomMissionId,
  type RtcSignal,
  type ClientMessage,
  type ServerMessage,
  type MissionInfo,
  type MissionManual,
  type MissionManualStation,
  type RoomSummary,
  type PlayerPosition,
  type DronePosition,
} from './protocol.js';
export { SIMON_COLORS, type SimonColor } from './puzzles/simon.js';
export { LEVER_FIGURE } from './puzzles/buttonSync.js';
export {
  PATTERN_FIGURE,
  SIGNAL_PATTERNS,
  TOKENS,
  tokenLabel,
  type SignalPattern,
  type SignalToken,
} from './puzzles/signal.js';
export type { RelayView } from './puzzles/relay.js';
export {
  DEPENDS_ON,
  SERVICES,
  serviceName,
  type RackUnit,
  type ServerCode,
  type ServerLed,
  type ServerLogLine,
  type ServerRow,
  type Service,
} from './puzzles/servers.js';
export { CHAT_PHRASES, CHAT_PHRASE_IDS, chatText, type ChatPhrase } from './chat.js';
export {
  scaleMission,
  difficultyInfos,
  DIFFICULTIES,
  type Difficulty,
} from './difficulty.js';
