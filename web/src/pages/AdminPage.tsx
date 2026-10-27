import { useState, useEffect } from 'react';
import { apiGet, apiPost } from '../lib/api';
import { fmt } from '../lib/ui';
import { AdminContentTab, AdminAnnouncementsTab, AdminSettingsTab, AdminMarketTab, AdminSocialTab, AdminAuditTab } from './AdminExtended';

export default function AdminPage() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'overview' | 'players' | 'cdk' | 'events' | 'content' | 'announcements' | 'settings' | 'market' | 'social' | 'logs' | 'audit'>('overview');
  const [overview, setOverview] = useState<any>(null);
  const [players, setPlayers] = useState<any[]>([]);
  const [playerQuery, setPlayerQuery] = useState('');
  const [cdks, setCdks] = useState<any[]>([]);
  const [logs, setLogs] = useState<any>(null);
  const [content, setContent] = useState<any>(null);
  const [notice, setNotice] = useState('');

  const toast = (msg: string) => { setNotice(msg); setTimeout(() => setNotice(''), 3000); };

  useEffect(() => {
    apiGet<any>('/api/admin/me').then(() => setLoggedIn(true)).catch(() => setLoggedIn(false));
  }, []);

  useEffect(() => {
    if (!loggedIn) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedIn, tab]);

  const refresh = async () => {
    if (tab === 'overview') setOverview(await apiGet('/api/admin/overview').catch(() => null));
    if (tab === 'players') {
      const r = await apiGet<any>(`/api/admin/players?q=${encodeURIComponent(playerQuery)}`).catch(() => null);
      setPlayers(r?.players ?? []);
    }
    if (tab === 'cdk') setCdks((await apiGet<any>('/api/admin/cdks').catch(() => null))?.items ?? []);
    if (tab === 'content') setContent(await apiGet('/api/admin/content/overview').catch(() => null));
    if (tab === 'logs') setLogs(await apiGet('/api/admin/logs').catch(() => null));
  };

  if (loggedIn === null) return <div className="page-loading"><span className="spin">◌</span>正在验证管理员身份</div>;

  if (!loggedIn) {
    return (
      <div className="standard-page admin-page" style={{ maxWidth: 420 }}>
        <header className="page-heading"><div><h1>管理后台</h1><p>Arcane Reelax Admin</p></div></header>
        <section className="auth-form" style={{ border: '1px solid var(--border)', padding: 24, borderRadius: 4 }}>
          <label style={{ display: 'block', marginTop: 10 }}>管理员账号
            <input style={{ width: '100%', marginTop: 6, border: '1px solid var(--border)', borderRadius: 3, padding: '10px 12px' }} value={username} onChange={(e) => setUsername(e.target.value)} />
          </label>
          <label style={{ display: 'block', marginTop: 10 }}>密码
            <input type="password" style={{ width: '100%', marginTop: 6, border: '1px solid var(--border)', borderRadius: 3, padding: '10px 12px' }} value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          {error && <p className="operation-error">{error}</p>}
          <button className="primary-button" style={{ width: '100%', marginTop: 16 }} type="button" onClick={async () => {
            try {
              await apiPost('/api/admin/login', { username, password });
              setLoggedIn(true);
            } catch (e: any) { setError(e.message); }
          }}>登录管理后台</button>
        </section>
      </div>
    );
  }

  return (
    <div className="standard-page admin-page" style={{ maxWidth: 1200 }}>
      <header className="page-heading">
        <div><h1>管理后台</h1><p>玩家管理 · 资源发放 · 内容与事件控制</p></div>
        <button className="secondary-button" type="button" onClick={async () => { await apiPost('/api/admin/logout', {}); setLoggedIn(false); }}>退出管理</button>
      </header>
      {notice && <div className="operation-error" style={{ color: 'var(--reed)' }}>{notice}</div>}

      <div className="segmented-control admin-tabs">
        <button type="button" aria-pressed={tab === 'overview'} onClick={() => setTab('overview')}>总览</button>
        <button type="button" aria-pressed={tab === 'players'} onClick={() => setTab('players')}>玩家</button>
        <button type="button" aria-pressed={tab === 'cdk'} onClick={() => setTab('cdk')}>CDK 礼包码</button>
        <button type="button" aria-pressed={tab === 'events'} onClick={() => setTab('events')}>事件控制</button>
        <button type="button" aria-pressed={tab === 'content'} onClick={() => setTab('content')}>内容管理</button>
        <button type="button" aria-pressed={tab === 'announcements'} onClick={() => setTab('announcements')}>公告</button>
        <button type="button" aria-pressed={tab === 'settings'} onClick={() => setTab('settings')}>参数</button>
        <button type="button" aria-pressed={tab === 'market'} onClick={() => setTab('market')}>市场</button>
        <button type="button" aria-pressed={tab === 'social'} onClick={() => setTab('social')}>社交</button>
        <button type="button" aria-pressed={tab === 'logs'} onClick={() => setTab('logs')}>日志</button>
        <button type="button" aria-pressed={tab === 'audit'} onClick={() => setTab('audit')}>审计</button>
      </div>

      {tab === 'overview' && overview && (
        <div className="admin-grid">
          <div className="admin-stat"><span>玩家</span><b className="mono">{fmt(overview.counts.players)}</b></div>
          <div className="admin-stat"><span>账号</span><b className="mono">{fmt(overview.counts.accounts)}</b></div>
          <div className="admin-stat"><span>在线钓鱼批次</span><b className="mono">{fmt(overview.counts.activeRuns)}</b></div>
          <div className="admin-stat"><span>市场在售订单</span><b className="mono">{fmt(overview.counts.activeOrders)}</b></div>
          <div className="admin-stat"><span>公会</span><b className="mono">{fmt(overview.counts.guilds)}</b></div>
          <div className="admin-stat"><span>组队船</span><b className="mono">{fmt(overview.counts.partyBoats)}</b></div>
          <div className="admin-stat"><span>今日签到</span><b className="mono">{fmt(overview.counts.todayCheckIns)}</b></div>
          <div className="admin-stat"><span>全服金币</span><b className="gold-text mono">{fmt(overview.economy.gold)}</b></div>
          <div className="admin-stat"><span>全服遗物</span><b className="mono">{fmt(overview.economy.relics)}</b></div>
          <div className="admin-stat"><span>全服碎片</span><b className="mono">{fmt(overview.economy.fragments)}</b></div>
        </div>
      )}

      {tab === 'players' && (
        <>
          <div className="admin-toolbar">
            <input placeholder="搜索玩家昵称 / ID / 邮箱" value={playerQuery} onChange={(e) => setPlayerQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') refresh(); }} />
            <button className="secondary-button" type="button" onClick={refresh}>搜索</button>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>ID</th><th>昵称</th><th>等级</th><th>金币</th><th>遗物</th><th>碎片</th><th>总杆数</th><th>操作</th></tr></thead>
              <tbody>
                {players.map((p) => (
                  <AdminPlayerRow key={p.id} p={p} toast={toast} onChanged={refresh} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'cdk' && <AdminCdkTab cdks={cdks} toast={toast} onChanged={refresh} />}
      {tab === 'events' && <AdminEventsTab toast={toast} onChanged={refresh} />}
      {tab === 'content' && <AdminContentTab toast={toast} />}

      {tab === 'announcements' && <AdminAnnouncementsTab toast={toast} />}
      {tab === 'settings' && <AdminSettingsTab toast={toast} />}
      {tab === 'market' && <AdminMarketTab toast={toast} />}
      {tab === 'social' && <AdminSocialTab />}

      {tab === 'audit' && <AdminAuditTab />}

      {tab === 'logs' && logs && (
        <>
          <div className="section-title"><h2>CDK 兑换记录</h2></div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>兑换码</th><th>玩家</th><th>时间</th></tr></thead>
              <tbody>
                {logs.redemptions?.map((r: any) => (
                  <tr key={r.code + r.redeemedAt}><td className="mono">{r.code}</td><td className="mono">{r.playerId.slice(0, 8)}…</td><td>{r.redeemedAt?.slice(0, 16)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function AdminPlayerRow({ p, toast, onChanged }: { p: any; toast: (s: string) => void; onChanged: () => void }) {
  const [gold, setGold] = useState('');
  const [relics, setRelics] = useState('');
  const [fragments, setFragments] = useState('');
  const [level, setLevel] = useState('');

  return (
    <tr>
      <td className="mono">{p.publicId}</td>
      <td>{p.nickname}</td>
      <td className="mono">{fmt(p.level)}</td>
      <td className="gold-text mono">{fmt(p.gold)}</td>
      <td className="mono">{fmt(p.relics)}</td>
      <td className="mono">{fmt(p.fragments)}</td>
      <td className="mono">{fmt(p.totalCasts)}</td>
      <td>
        <div className="admin-actions">
          <input placeholder="金币" value={gold} onChange={(e) => setGold(e.target.value)} />
          <input placeholder="遗物" value={relics} onChange={(e) => setRelics(e.target.value)} />
          <input placeholder="碎片" value={fragments} onChange={(e) => setFragments(e.target.value)} />
          <button className="primary-button" type="button" onClick={async () => {
            await apiPost(`/api/admin/players/${p.id}/grant`, {
              gold: Number(gold || 0), relics: Number(relics || 0), fragments: Number(fragments || 0),
            });
            toast(`已发放：${p.nickname}`); onChanged();
          }}>发放</button>
          <input placeholder="等级" value={level} onChange={(e) => setLevel(e.target.value)} />
          <button className="secondary-button" type="button" onClick={async () => {
            await apiPost(`/api/admin/players/${p.id}/level`, { level: Number(level) });
            toast(`已设置等级：${p.nickname}`); onChanged();
          }}>设级</button>
          <button className="secondary-button" type="button" onClick={async () => {
            if (!confirm(`重置 ${p.nickname} 的密码并使全部会话失效？`)) return;
            const result = await apiPost<any>(`/api/admin/players/${p.id}/reset-password`, {});
            toast(`临时密码：${result.temporaryPassword}`);
          }}>重置密码</button>
          <button className="danger-button" type="button" onClick={async () => {
            if (!confirm(`确认封禁 ${p.nickname}？`)) return;
            await apiPost(`/api/admin/players/${p.id}/ban`, { reason: '管理员操作' });
            toast(`已封禁：${p.nickname}`); onChanged();
          }}>封禁</button>
        </div>
      </td>
    </tr>
  );
}

function AdminCdkTab({ cdks, toast, onChanged }: { cdks: any[]; toast: (s: string) => void; onChanged: () => void }) {
  const [gold, setGold] = useState('100000');
  const [relics, setRelics] = useState('0');
  const [fragments, setFragments] = useState('0');
  const [count, setCount] = useState('1');
  const [generated, setGenerated] = useState('');

  return (
    <>
      <section className="admin-panel">
        <h3>生成礼包码</h3>
        <div className="admin-toolbar">
          <label>数量 <input value={count} onChange={(e) => setCount(e.target.value)} /></label>
          <label>金币 <input value={gold} onChange={(e) => setGold(e.target.value)} /></label>
          <label>遗物 <input value={relics} onChange={(e) => setRelics(e.target.value)} /></label>
          <label>碎片 <input value={fragments} onChange={(e) => setFragments(e.target.value)} /></label>
          <button className="primary-button" type="button" onClick={async () => {
            const r = await apiPost<any>('/api/admin/cdks', {
              count: Number(count), gold: Number(gold), relics: Number(relics), fragments: Number(fragments),
            });
            setGenerated(r.codes.join('\n'));
            toast(`已生成 ${r.codes.length} 个礼包码`); onChanged();
          }}>生成</button>
        </div>
        {generated && (
          <div className="admin-cdk-output">
            <p className="muted">新生成的礼包码（玩家可在 设置 → CDK 兑换 使用）：</p>
            <pre>{generated}</pre>
          </div>
        )}
      </section>
      <section className="admin-panel">
        <h3>已生成礼包码（{cdks.length}）</h3>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>兑换码</th><th>奖励</th><th>已用 / 上限</th><th>过期</th><th>操作</th></tr></thead>
            <tbody>
              {cdks.map((c) => (
                <tr key={c.code}>
                  <td className="mono">{c.code}</td>
                  <td>{c.payload?.gold ? `金币 ${fmt(c.payload.gold)}` : ''}{c.payload?.relics ? ` 遗物 ${fmt(c.payload.relics)}` : ''}{c.payload?.fragments ? ` 碎片 ${fmt(c.payload.fragments)}` : ''}</td>
                  <td className="mono">{c.redemptions} / {c.maxRedemptions}</td>
                  <td>{c.expiresAt ? c.expiresAt.slice(0, 10) : '永不过期'}</td>
                  <td><button className="danger-button" type="button" onClick={async () => { await apiPost(`/api/admin/cdks/${c.code}/revoke`, {}); toast('已撤销'); onChanged(); }}>撤销</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function AdminEventsTab({ toast, onChanged }: { toast: (s: string) => void; onChanged: () => void }) {
  const [resourceType, setResourceType] = useState('fish');
  const [target, setTarget] = useState('1000000');
  const [weatherId, setWeatherId] = useState('arcane_surge');
  const [buffType, setBuffType] = useState('experience');
  const [buffBp, setBuffBp] = useState('3000');
  const [buffHours, setBuffHours] = useState('4');

  return (
    <div className="admin-panels">
      <section className="admin-panel">
        <h3>奥术献祭 · 开新一轮</h3>
        <div className="admin-toolbar">
          <label>资源
            <select value={resourceType} onChange={(e) => setResourceType(e.target.value)}>
              <option value="fish">鱼</option><option value="gold">金币</option><option value="relic">遗物</option>
            </select>
          </label>
          <label>目标值 <input value={target} onChange={(e) => setTarget(e.target.value)} /></label>
          <button className="primary-button" type="button" onClick={async () => {
            await apiPost('/api/admin/events/sacrifice/round', { resourceType, target: Number(target) });
            toast('已开启新一轮献祭'); onChanged();
          }}>开启</button>
          <button className="secondary-button" type="button" onClick={async () => {
            await apiPost('/api/admin/events/sacrifice/complete', {});
            toast('已强制完成当前轮'); onChanged();
          }}>强制完成当前轮</button>
        </div>
      </section>

      <section className="admin-panel">
        <h3>天气覆盖</h3>
        <div className="admin-toolbar">
          <label>天气
            <select value={weatherId} onChange={(e) => setWeatherId(e.target.value)}>
              {['clear', 'rain', 'gale', 'mist', 'heatwave', 'tempest', 'wither_tide', 'gilded_current', 'arcane_surge'].map((w) => (
                <option key={w} value={w}>{w}</option>
              ))}
            </select>
          </label>
          <button className="primary-button" type="button" onClick={async () => {
            await apiPost('/api/admin/weather/override', { weatherId });
            toast(`已覆盖天气为 ${weatherId}（24 小时）`);
          }}>覆盖全服</button>
          <button className="secondary-button" type="button" onClick={async () => {
            await apiPost('/api/admin/weather/clear-override', {});
            toast('已清除天气覆盖');
          }}>清除覆盖</button>
        </div>
      </section>

      <section className="admin-panel">
        <h3>全服增益</h3>
        <div className="admin-toolbar">
          <label>类型
            <select value={buffType} onChange={(e) => setBuffType(e.target.value)}>
              {['experience', 'gold', 'strength', 'intelligence', 'luck', 'endurance'].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label>幅度基点（100 = 1%）<input value={buffBp} onChange={(e) => setBuffBp(e.target.value)} /></label>
          <label>时长（小时）<input value={buffHours} onChange={(e) => setBuffHours(e.target.value)} /></label>
          <button className="primary-button" type="button" onClick={async () => {
            await apiPost('/api/admin/global-buff', { buffType, bonusBasisPoints: Number(buffBp), durationHours: Number(buffHours) });
            toast('已开启全服增益');
          }}>开启</button>
        </div>
      </section>

      <section className="admin-panel">
        <h3>排行榜</h3>
        <div className="admin-toolbar">
          <button className="primary-button" type="button" onClick={async () => {
            await apiPost('/api/admin/leaderboards/regenerate', {});
            toast('排行榜已重新生成'); onChanged();
          }}>重新生成今日排行榜</button>
        </div>
      </section>
    </div>
  );
}
