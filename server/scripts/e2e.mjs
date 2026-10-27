const BASE = 'http://localhost:3000';
let cookie = '';

async function api(path, opts = {}) {
  const headers = { ...(opts.body ? { 'Content-Type': 'application/json' } : {}) };
  if (cookie) headers['Cookie'] = cookie;
  const res = await fetch(BASE + path, { ...opts, headers, redirect: 'manual' });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  let body = null;
  try { body = await res.json(); } catch {}
  return { status: res.status, body };
}

const results = [];
const t = (name, cond, extra = '') => {
  results.push({ name, ok: !!cond, extra });
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' | ' + extra : ''}`);
};

async function main() {
  const email = `e2e_${Date.now()}@example.com`;
  let r = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password: 'Test12345!', nickname: '端到端' + String(Date.now()).slice(-5), acceptedUserAgreement: true, acceptedUserAgreementVersion: '2026-08-13' }) });
  t('register', r.status === 200 && r.body.player?.level === 1, `status=${r.status}`);

  r = await api('/api/me');
  t('me', r.status === 200 && r.body.player?.nickname?.startsWith('端到端'));

  r = await api('/api/content/bootstrap');
  t('bootstrap', r.body.fish?.length === 990 && r.body.biomes?.length === 15, `fish=${r.body.fish?.length}`);

  r = await api('/api/biomes');
  t('biomes', r.body.biomes?.length === 15 && r.body.biomes[0].isCurrent);

  r = await api('/api/rods');
  t('rods', r.body.rods?.length === 13, `rods=${r.body.rods?.length}`);

  r = await api('/api/baits');
  t('baits', r.body.baits?.length === 5);

  r = await api('/api/quests');
  t('quests', r.body.periods?.length === 3 && r.body.periods[0].tasks?.length > 0, `daily=${r.body.periods?.[0]?.tasks?.length}`);

  r = await api('/api/achievements');
  t('achievements', r.body.summary?.total === 259, `total=${r.body.summary?.total}`);

  r = await api('/api/mastery');
  t('mastery', r.body.biomes?.length === 15 && r.body.biomes[0].rarities?.length === 9);

  r = await api('/api/mastery/talents');
  t('talents', r.body.talents?.length === 5);

  r = await api('/api/fishing/start', { method: 'POST', body: JSON.stringify({ mode: 'online' }) });
  t('fishing start', r.status === 200 && r.body.run?.remainingCasts === 200, `remaining=${r.body.run?.remainingCasts}`);

  await new Promise((res) => setTimeout(res, 7000));
  r = await api('/api/fishing/sync', { method: 'POST', body: JSON.stringify({}) });
  t('fishing sync catches', r.body.lastResult?.fishId?.startsWith('b_001'), `fish=${r.body.lastResult?.name}`);

  r = await api('/api/inventory/fish');
  t('inventory fish', r.body.fish?.length > 0, `types=${r.body.fish?.length}`);

  r = await api('/api/statistics');
  t('statistics', r.body.totals?.totalCasts >= 1);

  r = await api('/api/shop');
  t('shop', r.body.buffProducts?.length > 0, `buffs=${r.body.buffProducts?.length}`);

  r = await api('/api/shop/exchange-quote?kind=goldToRelic');
  t('exchange quote', r.body.currentUnitPrice > 0);

  r = await api('/api/daily-check-in');
  t('checkin', r.body.canClaim === true);

  r = await api('/api/daily-check-in/claim', { method: 'POST', body: JSON.stringify({}) });
  t('checkin claim', r.status === 200 && r.body.claim?.rewardDay === 1, `rewardDay=${r.body.claim?.rewardDay}`);

  r = await api('/api/daily-check-in');
  t('checkin claimed state', r.body.checkedInToday === true);

  r = await api('/api/market/config');
  t('market config', r.body.maxActiveOrdersPerPlayer === 50);

  r = await api('/api/market/fish/overview');
  t('market overview', Array.isArray(r.body.fish));

  r = await api('/api/tournaments/overview');
  t('tournaments overview', Array.isArray(r.body.upcoming));

  r = await api('/api/guild-tournaments/overview');
  t('guild tournaments', Array.isArray(r.body.upcoming));

  r = await api('/api/weekly-tournaments/overview');
  t('weekly tournaments', r.body.state !== undefined);

  r = await api('/api/events/arcane-sacrifice');
  t('arcane sacrifice', r.body.fishPoints?.common === 1);

  r = await api('/api/party-boats/overview');
  t('party boats', r.body.catalog?.length === 5);

  r = await api('/api/guilds/me');
  t('guilds me', r.body.config?.creationCost === 100000);

  r = await api('/api/guilds/search');
  t('guild search', Array.isArray(r.body.guilds));

  r = await api('/api/leaderboards');
  t('leaderboards', r.body.entries?.length > 0, `entries=${r.body.entries?.length}`);

  r = await api('/api/fishpedia?biomeId=b_001');
  t('fishpedia', r.body.fish?.length === 66, `fish=${r.body.fish?.length}`);

  r = await api('/api/inventory/chests');
  t('chests', r.body.chests?.length === 4);

  r = await api('/api/convenience');
  t('convenience', r.body.products?.length === 2);

  r = await api('/api/account');
  t('account', r.body.email === email);

  r = await api('/api/player/stats/allocate', { method: 'POST', body: JSON.stringify({ allocation: { strength: 0, intelligence: 0, luck: 0, endurance: 0 } }) });
  t('stats allocate empty', r.status === 200);

  // sell fish to NPC
  r = await api('/api/inventory/fish');
  const firstFish = r.body.fish?.[0];
  if (firstFish) {
    const sell = await api('/api/inventory/fish/sell', { method: 'POST', body: JSON.stringify({ fishId: firstFish.fishId, quantity: 1 }) });
    t('sell fish', sell.status === 200 && sell.body.goldEarned > 0, `gold=${sell.body?.goldEarned}`);
  } else {
    t('sell fish', false, 'no fish to sell');
  }

  // buy rod + upgrade
  r = await api('/api/me');
  const gold = r.body.player?.gold;
  if (gold >= 15000) {
    const buy = await api('/api/rods/strength_rod/purchase', { method: 'POST', body: JSON.stringify({}) });
    t('buy rod', buy.status === 200);
  } else {
    console.log(`SKIP buy rod (gold=${gold})`);
  }

  r = await api('/api/fishing/state');
  t('fishing state', r.status === 200);

  const failed = results.filter((x) => !x.ok);
  console.log(`\n==== ${results.length - failed.length}/${results.length} passed ====`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
