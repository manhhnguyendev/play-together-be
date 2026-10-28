import * as bcrypt from 'bcryptjs';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { AppDatabase } from './client';
import {
  behaviorPoints,
  charities,
  CONFIG_DEFAULTS,
  donations,
  gameRanks,
  games,
  gameTypeLinks,
  gameTypes,
  ledgerEntries,
  systemConfigs,
  userFavorites,
  userHobbies,
  userSkills,
  users,
  availabilityWindows,
  wallets,
  type Game,
  type GameRank,
  type User,
} from './schema';

export type SeedOptions = {
  adminEmail: string;
  adminPassword: string;
  charityEmail: string;
  charityPassword: string;
  demoData: boolean;
  bcryptRounds: number;
  now?: Date;
};

export type SeedSummary = {
  configs: number;
  games: number;
  gameTypes: number;
  ranks: number;
  gameTypeLinks: number;
  admin: 'created' | 'existing';
  charity: 'created' | 'existing';
  demoUsers: number;
};

const DEMO_PASSWORD = 'Demo@12345';

type GameSeed = { name: string; displayName: string; otherNames?: string };

const GAME_SEEDS: GameSeed[] = [
  { name: 'Arena of Valor', displayName: 'Liên Quân Mobile', otherNames: 'lq / aov / lien quan mobile' },
  { name: 'League of Legends', displayName: 'Liên Minh Huyền Thoại', otherNames: 'lmht / lol' },
  { name: 'Among Us', displayName: 'Among Us' },
  { name: 'Age of Empires', displayName: 'Đế Chế', otherNames: 'aoe / de che' },
  { name: 'DotA 2', displayName: 'DotA 2', otherNames: 'dota / dota 2' },
  { name: 'Grand Theft Auto V', displayName: 'GTA 5', otherNames: 'gta / gta v' },
  { name: 'Minecraft', displayName: 'Minecraft' },
  { name: 'World of Warcraft', displayName: 'Warcraft', otherNames: 'wow / warcraft' },
  { name: 'Super Mario 64', displayName: 'Mario 64', otherNames: 'mario' },
  { name: 'Angry Birds', displayName: 'Angry Birds' },
  { name: 'Warface Mobile', displayName: 'Warface' },
  { name: 'Call of Duty: Mobile', displayName: 'Call of Duty Mobile', otherNames: 'codm / cod mobile' },
  { name: 'Battle Prime Online', displayName: 'Battle Prime' },
  { name: 'Genshin Impact', displayName: 'Genshin Impact', otherNames: 'genshin' },
  { name: 'PUBG Mobile', displayName: 'PUBG Mobile', otherNames: 'pubg' },
  { name: 'Free Fire', displayName: 'Free Fire', otherNames: 'ff' },
  { name: 'Rules of Survival', displayName: 'Rules of Survival', otherNames: 'ros' },
  { name: 'FIFA Online 4', displayName: 'FIFA Online 4', otherNames: 'fifa / fifa 4' },
  { name: 'World of Tanks', displayName: 'World of Tanks', otherNames: 'wot' },
  { name: 'Blade & Soul', displayName: 'Blade & Soul' },
  { name: 'MU Online', displayName: 'MU Online', otherNames: 'mu' },
  { name: 'Half-Life', displayName: 'Half-Life' },
  { name: 'Sea of Thieves', displayName: 'Sea of Thieves' },
  { name: 'NARAKA: BLADEPOINT', displayName: 'NARAKA', otherNames: 'naraka' },
  { name: 'Valorant', displayName: 'Valorant', otherNames: 'valo' },
  { name: 'PUBG PC', displayName: 'PUBG PC', otherNames: 'pubg pc / pubg steam' },
];

type GameTypeSeed = { name: string; shortName: string; description?: string };

const GAME_TYPE_SEEDS: GameTypeSeed[] = [
  { name: 'Shooter', shortName: 'Shooter', description: 'Game bắn súng góc nhìn thứ nhất hoặc thứ ba, bao gồm cả battle royale.' },
  { name: 'Platformer', shortName: 'Platformer', description: 'Game đi cảnh, nhảy qua các nền tảng và chướng ngại vật.' },
  { name: 'Action', shortName: 'Action', description: 'Game hành động với nhịp độ nhanh và yêu cầu phản xạ.' },
  { name: 'Fighting', shortName: 'Fighting', description: 'Game đối kháng võ thuật giữa hai hoặc nhiều người chơi.' },
  { name: 'Beat-em up', shortName: 'Beat-em up', description: 'Game chặt chém với các đòn combo liên hoàn.' },
  { name: 'Stealth', shortName: 'Stealth', description: 'Game hành động lén lút, yêu cầu quan sát và căn thời gian.' },
  { name: 'Survival', shortName: 'Survival', description: 'Game sinh tồn: thu thập tài nguyên, chế tạo và chống lại môi trường.' },
  { name: 'Rhythm', shortName: 'Rhythm', description: 'Game âm nhạc và giai điệu.' },
  { name: 'Action-Adventure', shortName: 'Action-Adventure', description: 'Kết hợp hành động và khám phá cốt truyện.' },
  { name: 'Survival horror', shortName: 'Survival horror', description: 'Game kinh dị kết hợp sinh tồn.' },
  { name: 'Metroidvania', shortName: 'Metroidvania', description: 'Game 2D với bản đồ rộng và mở khóa kỹ năng dần dần.' },
  { name: 'Adventure', shortName: 'Adventure', description: 'Game phiêu lưu khám phá thế giới và cốt truyện.' },
  { name: 'Text game', shortName: 'Text game', description: 'Game tương tác chủ yếu bằng văn bản và lệnh.' },
  { name: 'Visual Novel', shortName: 'Visual Novel', description: 'Tiểu thuyết hình ảnh với lựa chọn hội thoại.' },
  { name: 'Role-playing game', shortName: 'RPG', description: 'Game nhập vai, phát triển nhân vật và trang bị.' },
  { name: 'Massively Multiplayer Online Role-Playing Game', shortName: 'MMORPG', description: 'Game nhập vai trực tuyến nhiều người chơi.' },
  { name: 'Tactical RPG', shortName: 'Tactical RPG', description: 'Game nhập vai chiến thuật theo lượt.' },
  { name: 'Sandbox RPG', shortName: 'Sandbox RPG', description: 'Game nhập vai thế giới mở, tự do khám phá.' },
  { name: 'Simulation', shortName: 'Simulation', description: 'Game mô phỏng đời sống, phương tiện hoặc quản lý.' },
  { name: 'Strategy', shortName: 'Strategy', description: 'Game chiến thuật yêu cầu tư duy và tính toán.' },
  { name: 'Real-time strategy', shortName: 'RTS', description: 'Game chiến thuật thời gian thực.' },
  { name: 'Turn base strategy', shortName: 'TBS', description: 'Game chiến thuật theo lượt.' },
  { name: 'Tower defense', shortName: 'Tower defense', description: 'Game thủ thành, chống lại các đợt tấn công.' },
  { name: 'Wargame', shortName: 'Wargame', description: 'Game chiến lược chiến tranh.' },
  { name: 'Sport Game', shortName: 'Sport', description: 'Game thể thao như bóng đá, đua xe, võ thuật.' },
  { name: 'Racing', shortName: 'Racing', description: 'Game đua xe.' },
  { name: 'Team sports', shortName: 'Team sports', description: 'Game thể thao đồng đội.' },
  { name: 'Competitive', shortName: 'Competitive', description: 'Game thi đấu eSport chuyên nghiệp.' },
  { name: 'Puzzle', shortName: 'Puzzle', description: 'Game giải đố rèn luyện trí não.' },
  { name: 'Casual', shortName: 'Casual', description: 'Game ngắn, luật chơi đơn giản.' },
  { name: 'Card game/ Board game', shortName: 'Card game/ Board game', description: 'Game thẻ bài và board game.' },
  { name: 'Multiplayer online battle arena', shortName: 'MOBA', description: 'Đấu trường trực tuyến nhiều người chơi, chú trọng phối hợp đồng đội.' },
];

const RANK_SEEDS: Record<string, string[]> = {
  'Arena of Valor': ['Đồng', 'Bạc', 'Vàng', 'Bạch Kim', 'Kim Cương', 'Tinh Anh', 'Cao Thủ', 'Chiến Tướng', 'Thách Đấu'],
  'League of Legends': ['Sắt', 'Đồng', 'Bạc', 'Vàng', 'Bạch Kim', 'Kim Cương', 'Cao Thủ', 'Thách Đấu'],
};

const GAME_TYPE_LINKS: Record<string, string[]> = {
  MOBA: ['League of Legends', 'Arena of Valor', 'DotA 2'],
  Shooter: [
    'Call of Duty: Mobile',
    'PUBG Mobile',
    'Free Fire',
    'Valorant',
    'Battle Prime Online',
    'Warface Mobile',
    'PUBG PC',
    'Rules of Survival',
  ],
  Survival: ['Among Us', 'Minecraft', 'Sea of Thieves', 'NARAKA: BLADEPOINT'],
  RPG: ['Genshin Impact', 'MU Online', 'Blade & Soul', 'World of Warcraft'],
  MMORPG: ['World of Warcraft', 'MU Online', 'Blade & Soul'],
  'Action-Adventure': ['Grand Theft Auto V', 'Minecraft', 'Genshin Impact'],
  Action: ['Grand Theft Auto V', 'NARAKA: BLADEPOINT', 'Valorant'],
  Strategy: ['Age of Empires', 'World of Tanks'],
  RTS: ['Age of Empires'],
  'Sandbox RPG': ['Minecraft'],
  Platformer: ['Super Mario 64'],
  Casual: ['Angry Birds', 'Among Us'],
  Puzzle: ['Angry Birds'],
  Sport: ['FIFA Online 4'],
  'Team sports': ['FIFA Online 4'],
  Competitive: ['Valorant', 'League of Legends', 'Arena of Valor'],
  Fighting: ['NARAKA: BLADEPOINT'],
};

type DemoPlayerSeed = {
  email: string;
  name: string;
  city: string;
  gender: 'MALE' | 'FEMALE' | 'OTHER';
  dateOfBirth: string;
  bio: string;
  pricePerHour: number;
  maxHoursPerHire: number;
  rankingPoints: number;
  ratingAverage: number;
  ratingCount: number;
  ordersCount: number;
  completedOrdersCount: number;
  totalHours: number;
  onTimeCount: number;
  skills: { game: string; rank?: string }[];
  hobbies: string[];
};

const DEMO_PLAYERS: DemoPlayerSeed[] = [
  {
    email: 'demo.player1@playtogether.local',
    name: 'Nguyễn Minh Anh',
    city: 'Hồ Chí Minh',
    gender: 'FEMALE',
    dateOfBirth: '2001-03-14',
    bio: 'Cao thủ Liên Quân, nhận kèo leo rank buổi tối.',
    pricePerHour: 80_000,
    maxHoursPerHire: 4,
    rankingPoints: 320,
    ratingAverage: 4.8,
    ratingCount: 24,
    ordersCount: 30,
    completedOrdersCount: 28,
    totalHours: 96,
    onTimeCount: 26,
    skills: [
      { game: 'Arena of Valor', rank: 'Cao Thủ' },
      { game: 'League of Legends', rank: 'Kim Cương' },
    ],
    hobbies: ['Arena of Valor', 'League of Legends', 'Genshin Impact'],
  },
  {
    email: 'demo.player2@playtogether.local',
    name: 'Trần Quốc Bảo',
    city: 'Đà Nẵng',
    gender: 'MALE',
    dateOfBirth: '2000-07-02',
    bio: 'Chuyên PUBG Mobile và Free Fire, giao tiếp vui vẻ.',
    pricePerHour: 60_000,
    maxHoursPerHire: 3,
    rankingPoints: 240,
    ratingAverage: 4.5,
    ratingCount: 18,
    ordersCount: 22,
    completedOrdersCount: 20,
    totalHours: 61,
    onTimeCount: 19,
    skills: [{ game: 'PUBG Mobile' }, { game: 'Free Fire' }],
    hobbies: ['PUBG Mobile', 'Free Fire', 'Call of Duty: Mobile'],
  },
  {
    email: 'demo.player3@playtogether.local',
    name: 'Lê Thu Hà',
    city: 'Hà Nội',
    gender: 'FEMALE',
    dateOfBirth: '2002-11-23',
    bio: 'Tactical shooter và Minecraft builder, nhận kèo cuối tuần.',
    pricePerHour: 100_000,
    maxHoursPerHire: 5,
    rankingPoints: 410,
    ratingAverage: 4.9,
    ratingCount: 31,
    ordersCount: 35,
    completedOrdersCount: 34,
    totalHours: 128,
    onTimeCount: 33,
    skills: [{ game: 'Valorant' }, { game: 'Call of Duty: Mobile' }, { game: 'Minecraft' }],
    hobbies: ['Valorant', 'Call of Duty: Mobile', 'Minecraft'],
  },
  {
    email: 'demo.player4@playtogether.local',
    name: 'Phạm Gia Huy',
    city: 'Hồ Chí Minh',
    gender: 'MALE',
    dateOfBirth: '1999-05-09',
    bio: 'Genshin Impact guide, sẵn sàng hỗ trợ nhiệm vụ và la hoàn.',
    pricePerHour: 70_000,
    maxHoursPerHire: 2,
    rankingPoints: 180,
    ratingAverage: 4.3,
    ratingCount: 12,
    ordersCount: 15,
    completedOrdersCount: 13,
    totalHours: 34,
    onTimeCount: 11,
    skills: [{ game: 'Genshin Impact' }, { game: 'Minecraft' }],
    hobbies: ['Genshin Impact', 'Minecraft', 'Among Us'],
  },
  {
    email: 'demo.player5@playtogether.local',
    name: 'Võ Thanh Tùng',
    city: 'Cần Thơ',
    gender: 'MALE',
    dateOfBirth: '1998-01-30',
    bio: 'Đế Chế và DotA 2, hướng dẫn build và micro cơ bản.',
    pricePerHour: 50_000,
    maxHoursPerHire: 3,
    rankingPoints: 150,
    ratingAverage: 4.1,
    ratingCount: 9,
    ordersCount: 12,
    completedOrdersCount: 10,
    totalHours: 27,
    onTimeCount: 8,
    skills: [{ game: 'Age of Empires' }, { game: 'DotA 2' }],
    hobbies: ['Age of Empires', 'DotA 2', 'League of Legends'],
  },
  {
    email: 'demo.player6@playtogether.local',
    name: 'Đặng Khánh Linh',
    city: 'Hải Phòng',
    gender: 'FEMALE',
    dateOfBirth: '2003-09-18',
    bio: 'GTA V roleplay và NARAKA, ưu tiên kèo tối muộn.',
    pricePerHour: 90_000,
    maxHoursPerHire: 4,
    rankingPoints: 275,
    ratingAverage: 4.6,
    ratingCount: 16,
    ordersCount: 20,
    completedOrdersCount: 19,
    totalHours: 55,
    onTimeCount: 17,
    skills: [{ game: 'Grand Theft Auto V' }, { game: 'NARAKA: BLADEPOINT' }],
    hobbies: ['Grand Theft Auto V', 'NARAKA: BLADEPOINT', 'Valorant'],
  },
];

const DEMO_HIRERS = [
  { email: 'demo.hirer1@playtogether.local', name: 'Hoàng An', city: 'Hồ Chí Minh', balance: 900_000 },
  { email: 'demo.hirer2@playtogether.local', name: 'Bùi Ngọc', city: 'Hà Nội', balance: 500_000 },
];

export async function seed(db: AppDatabase, options: SeedOptions): Promise<SeedSummary> {
  const now = options.now ?? new Date();
  const summary: SeedSummary = {
    configs: 0,
    games: 0,
    gameTypes: 0,
    ranks: 0,
    gameTypeLinks: 0,
    admin: 'existing',
    charity: 'existing',
    demoUsers: 0,
  };

  const configRows = await db
    .insert(systemConfigs)
    .values(
      Object.entries(CONFIG_DEFAULTS).map(([key, config]) => ({
        key,
        no: config.no,
        title: config.title,
        value: config.value,
        description: config.description,
        updatedAt: now,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: systemConfigs.id });
  summary.configs = configRows.length;

  const gameRows = await db
    .insert(games)
    .values(GAME_SEEDS.map((game) => ({ name: game.name, displayName: game.displayName, otherNames: game.otherNames ?? null })))
    .onConflictDoNothing()
    .returning({ id: games.id });
  summary.games = gameRows.length;

  const typeRows = await db
    .insert(gameTypes)
    .values(GAME_TYPE_SEEDS)
    .onConflictDoNothing()
    .returning({ id: gameTypes.id });
  summary.gameTypes = typeRows.length;

  const allGames = await db.select().from(games);
  const allTypes = await db.select().from(gameTypes);
  const gameByName = new Map(allGames.map((game) => [game.name.toLowerCase(), game]));
  const typeByShortName = new Map(allTypes.map((type) => [(type.shortName ?? type.name).toLowerCase(), type]));

  const rankRows = await db
    .insert(gameRanks)
    .values(
      Object.entries(RANK_SEEDS).flatMap(([gameName, ranks]) => {
        const game = gameByName.get(gameName.toLowerCase());
        if (!game) return [];
        return ranks.map((name, index) => ({ gameId: game.id, no: index + 1, name }));
      }),
    )
    .onConflictDoNothing()
    .returning({ id: gameRanks.id });
  summary.ranks = rankRows.length;

  const allRanks = await db.select().from(gameRanks);

  const linkValues: { gameId: string; gameTypeId: string }[] = [];
  for (const [typeName, gameNames] of Object.entries(GAME_TYPE_LINKS)) {
    const type = typeByShortName.get(typeName.toLowerCase());
    if (!type) continue;
    for (const gameName of gameNames) {
      const game = gameByName.get(gameName.toLowerCase());
      if (!game) continue;
      linkValues.push({ gameId: game.id, gameTypeId: type.id });
    }
  }
  const linkRows = linkValues.length
    ? await db.insert(gameTypeLinks).values(linkValues).onConflictDoNothing().returning({ gameId: gameTypeLinks.gameId })
    : [];
  summary.gameTypeLinks = linkRows.length;

  const admin = await ensureAccount(db, {
    email: options.adminEmail,
    name: 'Play Together Admin',
    password: options.adminPassword,
    passwordHashRounds: options.bcryptRounds,
    role: 'ADMIN',
    now,
  });
  summary.admin = admin.created ? 'created' : 'existing';

  const charityAccount = await ensureAccount(db, {
    email: options.charityEmail,
    name: 'Quỹ Ánh Sáng',
    password: options.charityPassword,
    passwordHashRounds: options.bcryptRounds,
    role: 'CHARITY',
    now,
  });
  summary.charity = charityAccount.created ? 'created' : 'existing';

  const charity = await ensureCharity(db, charityAccount.user.id, now);

  if (!options.demoData) return summary;

  const demoPasswordHash = await bcrypt.hash(DEMO_PASSWORD, options.bcryptRounds);
  const demoPlayers: { user: User; seed: DemoPlayerSeed; created: boolean }[] = [];

  for (const playerSeed of DEMO_PLAYERS) {
    const account = await ensureAccount(db, {
      email: playerSeed.email,
      name: playerSeed.name,
      passwordHash: demoPasswordHash,
      role: 'USER',
      isPlayer: true,
      city: playerSeed.city,
      gender: playerSeed.gender,
      dateOfBirth: playerSeed.dateOfBirth,
      bio: playerSeed.bio,
      pricePerHour: playerSeed.pricePerHour,
      maxHoursPerHire: playerSeed.maxHoursPerHire,
      rankingPoints: playerSeed.rankingPoints,
      ratingCount: playerSeed.ratingCount,
      ratingSum: Math.round(playerSeed.ratingAverage * playerSeed.ratingCount),
      ordersCount: playerSeed.ordersCount,
      completedOrdersCount: playerSeed.completedOrdersCount,
      totalHours: playerSeed.totalHours,
      onTimeCount: playerSeed.onTimeCount,
      now,
    });
    demoPlayers.push({ user: account.user, seed: playerSeed, created: account.created });
    if (account.created) summary.demoUsers += 1;
  }

  const demoHirers: { user: User; created: boolean; balance: number }[] = [];
  for (const hirerSeed of DEMO_HIRERS) {
    const account = await ensureAccount(db, {
      email: hirerSeed.email,
      name: hirerSeed.name,
      passwordHash: demoPasswordHash,
      role: 'USER',
      city: hirerSeed.city,
      availableBalance: hirerSeed.balance,
      now,
    });
    demoHirers.push({ user: account.user, created: account.created, balance: hirerSeed.balance });
    if (account.created) summary.demoUsers += 1;
  }

  await ensureDemoProfiles(db, demoPlayers, gameByName, allRanks, now);
  await ensureDemoDonation(db, demoHirers[0]?.user, charity, now);

  return summary;
}

type AccountInput = {
  email: string;
  name: string;
  role: 'USER' | 'ADMIN' | 'CHARITY';
  password?: string;
  passwordHash?: string;
  passwordHashRounds?: number;
  isPlayer?: boolean;
  city?: string;
  gender?: 'MALE' | 'FEMALE' | 'OTHER';
  dateOfBirth?: string;
  bio?: string;
  pricePerHour?: number;
  maxHoursPerHire?: number;
  rankingPoints?: number;
  ratingCount?: number;
  ratingSum?: number;
  ordersCount?: number;
  completedOrdersCount?: number;
  totalHours?: number;
  onTimeCount?: number;
  availableBalance?: number;
  now: Date;
};

async function ensureAccount(
  db: AppDatabase,
  input: AccountInput,
): Promise<{ user: User; created: boolean }> {
  const email = input.email.trim().toLowerCase();
  const [existing] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);

  if (existing) {
    await ensureWallet(db, existing.id, 0, input.now);
    await db.insert(behaviorPoints).values({ userId: existing.id, updatedAt: input.now }).onConflictDoNothing();
    return { user: existing, created: false };
  }

  const passwordHash = input.passwordHash ?? (input.password ? await bcrypt.hash(input.password, input.passwordHashRounds ?? 12) : null);

  const [created] = await db
    .insert(users)
    .values({
      email,
      passwordHash,
      name: input.name,
      role: input.role,
      status: 'ONLINE',
      isActive: true,
      isPlayer: input.isPlayer ?? false,
      city: input.city ?? null,
      gender: input.gender ?? 'OTHER',
      dateOfBirth: input.dateOfBirth ?? null,
      bio: input.bio ?? null,
      pricePerHour: input.pricePerHour ?? 10_000,
      maxHoursPerHire: input.maxHoursPerHire ?? 1,
      rankingPoints: input.rankingPoints ?? 0,
      ratingCount: input.ratingCount ?? 0,
      ratingSum: input.ratingSum ?? 0,
      ordersCount: input.ordersCount ?? 0,
      completedOrdersCount: input.completedOrdersCount ?? 0,
      totalHours: input.totalHours ?? 0,
      onTimeCount: input.onTimeCount ?? 0,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .returning();

  await ensureWallet(db, created.id, input.availableBalance ?? 0, input.now);
  await db.insert(behaviorPoints).values({ userId: created.id, updatedAt: input.now }).onConflictDoNothing();

  if ((input.availableBalance ?? 0) > 0) {
    const [wallet] = await db.select().from(wallets).where(eq(wallets.userId, created.id)).limit(1);
    if (wallet) await postDepositLedger(db, wallet.id, created.id, input.availableBalance ?? 0, input.now);
  }

  return { user: created, created: true };
}

async function ensureWallet(db: AppDatabase, userId: string, balance: number, now: Date) {
  const [existing] = await db.select().from(wallets).where(eq(wallets.userId, userId)).limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(wallets)
    .values({ userId, availableBalance: balance, createdAt: now, updatedAt: now })
    .onConflictDoNothing()
    .returning();

  return created ?? (await db.select().from(wallets).where(eq(wallets.userId, userId)).limit(1))[0];
}

async function ensureCharity(db: AppDatabase, userId: string, now: Date) {
  const [existing] = await db.select().from(charities).where(eq(charities.userId, userId)).limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(charities)
    .values({
      userId,
      organizationName: 'Quỹ Ánh Sáng',
      information: 'Quỹ hỗ trợ trẻ em có hoàn cảnh khó khăn tiếp cận thiết bị học tập và internet.',
      address: '128 Nguyễn Thị Minh Khai, Quận 3, Hồ Chí Minh',
      email: 'contact@anh-sang.local',
      phone: '0901234567',
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning();

  return created ?? (await db.select().from(charities).where(eq(charities.userId, userId)).limit(1))[0];
}

async function ensureDemoProfiles(
  db: AppDatabase,
  players: { user: User; seed: DemoPlayerSeed; created: boolean }[],
  gameByName: Map<string, Game>,
  ranks: GameRank[],
  now: Date,
) {
  for (const player of players) {
    if (!player.created) continue;

    const skillValues: { userId: string; gameId: string; rankId: string | null }[] = [];
    for (const skill of player.seed.skills) {
      const game = gameByName.get(skill.game.toLowerCase());
      if (!game) continue;
      const rank = skill.rank
        ? ranks.find((row) => row.gameId === game.id && row.name === skill.rank)
        : undefined;
      skillValues.push({ userId: player.user.id, gameId: game.id, rankId: rank?.id ?? null });
    }
    if (skillValues.length) {
      await db.insert(userSkills).values(skillValues).onConflictDoNothing();
    }

    const hobbyValues = player.seed.hobbies
      .map((name) => gameByName.get(name.toLowerCase()))
      .filter((game): game is Game => Boolean(game))
      .map((game) => ({ userId: player.user.id, gameId: game.id, createdAt: now }));
    if (hobbyValues.length) {
      await db.insert(userHobbies).values(hobbyValues).onConflictDoNothing();
      await db
        .insert(userFavorites)
        .values(hobbyValues.map((hobby) => ({ userId: hobby.userId, gameId: hobby.gameId, createdAt: now })))
        .onConflictDoNothing();
    }

    const weekdayEvening = [1, 2, 3, 4, 5].map((day) => ({
      userId: player.user.id,
      dayOfWeek: day,
      startMinute: 18 * 60,
      endMinute: 23 * 60,
      createdAt: now,
    }));
    const weekend = [6, 7].map((day) => ({
      userId: player.user.id,
      dayOfWeek: day,
      startMinute: 9 * 60,
      endMinute: 23 * 60,
      createdAt: now,
    }));
    await db.insert(availabilityWindows).values([...weekdayEvening, ...weekend]);
  }
}

async function ensureDemoDonation(
  db: AppDatabase,
  donor: User | undefined,
  charity: typeof charities.$inferSelect,
  now: Date,
) {
  if (!donor) return;

  const [existing] = await db
    .select({ id: donations.id })
    .from(donations)
    .where(eq(donations.donorId, donor.id))
    .limit(1);
  if (existing) return;

  const [wallet] = await db.select().from(wallets).where(eq(wallets.userId, donor.id)).limit(1);
  if (!wallet) return;

  const amount = 100_000;
  const transactionId = randomUUID();

  await db.transaction(async (tx) => {
    await tx
      .update(wallets)
      .set({ availableBalance: sql`${wallets.availableBalance} - ${amount}`, updatedAt: now })
      .where(eq(wallets.id, wallet.id));
    await tx
      .update(charities)
      .set({ balance: sql`${charities.balance} + ${amount}`, updatedAt: now })
      .where(eq(charities.id, charity.id));

    await tx.insert(donations).values({
      donorId: donor.id,
      charityId: charity.id,
      amount,
      message: 'Chúc các bạn nhỏ luôn vững tin và học giỏi.',
      createdAt: now,
    });

    await tx.insert(ledgerEntries).values([
      {
        transactionId,
        accountType: 'USER',
        accountId: donor.id,
        walletId: wallet.id,
        direction: 'DEBIT',
        type: 'DONATION',
        amount,
        note: 'Seed demo donation',
        createdAt: now,
      },
      {
        transactionId,
        accountType: 'CHARITY',
        accountId: charity.userId,
        charityId: charity.id,
        direction: 'CREDIT',
        type: 'DONATION',
        amount,
        note: 'Seed demo donation',
        createdAt: now,
      },
    ]);
  });
}

async function postDepositLedger(db: AppDatabase, walletId: string, userId: string, amount: number, now: Date) {
  const transactionId = randomUUID();
  await db.insert(ledgerEntries).values([
    {
      transactionId,
      accountType: 'USER',
      accountId: userId,
      walletId,
      direction: 'CREDIT',
      type: 'DEPOSIT',
      amount,
      note: 'Seed demo opening balance',
      createdAt: now,
    },
    {
      transactionId,
      accountType: 'EXTERNAL',
      accountId: null,
      direction: 'DEBIT',
      type: 'DEPOSIT',
      amount,
      note: 'Seed demo opening balance',
      createdAt: now,
    },
  ]);
}

export const SEED_DEMO_PASSWORD = DEMO_PASSWORD;
