import { useEffect, useState } from 'react';
import { api, apiGet, apiPost, apiPut } from '../lib/api';
import { fmt } from '../lib/ui';

type Toast = (message: string) => void;

function useLoad<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const load = async () => {
    setLoading(true);
    try { setData(await apiGet<T>(path)); setError(''); }
    catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [path]);
  return { data, error, loading, reload: load };
}

export function AdminContentTab({ toast }: { toast: Toast }) {
  const [kind, setKind] = useState<'fish' | 'biome'>('fish');
  const [query, setQuery] = useState('');
  const [fish, setFish] = useState<any[]>([]);
  const [biomes, setBiomes] = useState<any[]>([]);
  const [overview, setOverview] = useState<any>(null);
  const [editing, setEditing] = useState<any>(null);
  const [error, setError] = useState('');
  const emptyFish = { id: '', name: '', description: '', biomeId: 'b_001', rarity: 'common', sellPrice: 25, imagePath: '' };
  const emptyBiome = { id: 'b_018', name: '', theme: '', requiredLevel: 1, unlockCost: 0, valueMultiplier: 1.1, directGoldMin: 50, directGoldMax: 100, orderIndex: 18 };
  const [form, setForm] = useState<any>(emptyFish);

  const load = async () => {
    try {
      const [f, b, o] = await Promise.all([
        apiGet<any>(`/api/admin/content/fish?q=${encodeURIComponent(query)}&limit=200`),
        apiGet<any>('/api/admin/content/biomes'),
        apiGet<any>('/api/admin/content/overview'),
      ]);
      setFish(f.items ?? []); setBiomes(b.items ?? []); setOverview(o); setError('');
    } catch (e: any) { setError(e.message); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [query]);

  const switchKind = (next: 'fish' | 'biome') => {
    setKind(next); setEditing(null); setForm(next === 'fish' ? emptyFish : emptyBiome);
  };

  const save = async () => {
    try {
      if (kind === 'fish') {
        const path = editing ? `/api/admin/content/fish/${editing.id}` : '/api/admin/content/fish';
        if (editing) await apiPut(path, form);
        else await apiPost(path, form);
        toast(editing ? '鱼种已更新' : '鱼种已创建');
      } else {
        const path = editing ? `/api/admin/content/biomes/${editing.id}` : '/api/admin/content/biomes';
        if (editing) await apiPut(path, form);
        else await apiPost(path, form);
        toast(editing ? '地图已更新' : '地图已创建');
      }
      setEditing(null); setForm(kind === 'fish' ? emptyFish : emptyBiome); await load();
    } catch (e: any) { setError(e.message); }
  };

  const editFish = (row: any) => { setEditing(row); setForm({ ...row }); setKind('fish'); };
  const editBiome = (row: any) => { setEditing(row); setForm({ ...row }); setKind('biome'); };
  const removeFish = async (row: any) => {
    if (!window.confirm(`删除鱼种「${row.name}」？此操作不可撤销。`)) return;
    try { await api(`/api/admin/content/fish/${row.id}`, { method: 'DELETE' }); toast('已删除'); await load(); }
    catch (e: any) { setError(e.message); }
  };

  return (
    <div className="admin-panels">
      {overview && (
        <div className="admin-grid">
          <div className="admin-stat"><span>鱼种</span><b className="mono">{fmt(overview.counts.fish)}</b></div>
          <div className="admin-stat"><span>地图</span><b className="mono">{fmt(overview.counts.biomes)}</b></div>
          <div className="admin-stat"><span>鱼竿</span><b className="mono">{fmt(overview.counts.rods)}</b></div>
          <div className="admin-stat"><span>成就</span><b className="mono">{fmt(overview.counts.achievements)}</b></div>
          <div className="admin-stat"><span>任务模板</span><b className="mono">{fmt(overview.counts.questTemplates)}</b></div>
        </div>
      )}
      <section className="admin-panel">
        <div className="admin-editor-head">
          <div className="segmented-control">
            <button type="button" aria-pressed={kind === 'fish'} onClick={() => switchKind('fish')}>鱼种</button>
            <button type="button" aria-pressed={kind === 'biome'} onClick={() => switchKind('biome')}>地图</button>
          </div>
          {kind === 'fish' && <input placeholder="搜索鱼种 ID / 名称" value={query} onChange={(e) => setQuery(e.target.value)} />}
        </div>
        {error && <div className="operation-error">{error}</div>}
        <div className="admin-editor-grid">
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>{kind === 'fish' ? <tr><th>ID</th><th>鱼种</th><th>地图</th><th>稀有度</th><th>价格</th><th>操作</th></tr> : <tr><th>ID</th><th>地图</th><th>等级</th><th>解锁价</th><th>鱼种数</th><th>操作</th></tr>}</thead>
              <tbody>
                {kind === 'fish' ? fish.map((row) => (
                  <tr key={row.id}>
                    <td className="mono">{row.id}</td><td>{row.name}</td><td>{row.biomeId}</td><td>{row.rarity}</td><td className="gold-text mono">{fmt(row.sellPrice)}</td>
                    <td className="admin-row-actions"><button className="secondary-button" onClick={() => editFish(row)}>编辑</button><button className="danger-button" onClick={() => removeFish(row)}>删除</button></td>
                  </tr>
                )) : biomes.map((row) => (
                  <tr key={row.id}>
                    <td className="mono">{row.id}</td><td>{row.name}</td><td>{row.requiredLevel}</td><td className="gold-text mono">{fmt(row.unlockCost)}</td><td>{row.fishCount}</td>
                    <td><button className="secondary-button" onClick={() => editBiome(row)}>编辑</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <aside className="admin-form-card">
            <h3>{editing ? `编辑${kind === 'fish' ? '鱼种' : '地图'}` : `新增${kind === 'fish' ? '鱼种' : '地图'}`}</h3>
            {kind === 'fish' ? (
              <>
                <label>ID<input value={form.id} disabled={!!editing} onChange={(e) => setForm({ ...form, id: e.target.value })} /></label>
                <label>名称<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
                <div className="admin-form-pair">
                  <label>地图<select value={form.biomeId} onChange={(e) => setForm({ ...form, biomeId: e.target.value })}>{biomes.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
                  <label>稀有度<select value={form.rarity} onChange={(e) => setForm({ ...form, rarity: e.target.value })}>{['common','uncommon','fine','rare','epic','legendary','mythic','exotic','arcane'].map((r) => <option key={r}>{r}</option>)}</select></label>
                </div>
                <label>售价<input type="number" value={form.sellPrice} onChange={(e) => setForm({ ...form, sellPrice: Number(e.target.value) })} /></label>
                <label>图片路径<input value={form.imagePath} onChange={(e) => setForm({ ...form, imagePath: e.target.value })} /></label>
                <label>描述<textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
              </>
            ) : (
              <>
                <label>ID<input value={form.id} disabled={!!editing} onChange={(e) => setForm({ ...form, id: e.target.value })} /></label>
                <label>名称<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
                <div className="admin-form-pair">
                  <label>等级<input type="number" value={form.requiredLevel} onChange={(e) => setForm({ ...form, requiredLevel: Number(e.target.value) })} /></label>
                  <label>解锁金币<input type="number" value={form.unlockCost} onChange={(e) => setForm({ ...form, unlockCost: Number(e.target.value) })} /></label>
                </div>
                <label>价值倍率<input type="number" step="0.01" value={form.valueMultiplier} onChange={(e) => setForm({ ...form, valueMultiplier: Number(e.target.value) })} /></label>
                <label>主题描述<textarea value={form.theme} onChange={(e) => setForm({ ...form, theme: e.target.value })} /></label>
              </>
            )}
            <div className="admin-form-actions">
              <button className="primary-button" type="button" onClick={save}>{editing ? '保存修改' : '创建'}</button>
              <button className="ghost-button" type="button" onClick={() => { setEditing(null); setForm(kind === 'fish' ? emptyFish : emptyBiome); }}>清空</button>
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}

export function AdminAnnouncementsTab({ toast }: { toast: Toast }) {
  const { data, error, reload } = useLoad<any>('/api/admin/announcements');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [level, setLevel] = useState('info');
  const create = async () => {
    await apiPost('/api/admin/announcements', { title, body, level });
    setTitle(''); setBody(''); toast('公告已发布'); await reload();
  };
  const toggle = async (item: any) => { await apiPut(`/api/admin/announcements/${item.id}`, { isActive: !item.isActive }); await reload(); };
  const remove = async (item: any) => { if (!window.confirm(`删除公告「${item.title}」？`)) return; await api(`/api/admin/announcements/${item.id}`, { method: 'DELETE' }); toast('公告已删除'); await reload(); };
  return (
    <div className="admin-panels">
      <section className="admin-panel">
        <h3>发布全服公告</h3>
        <div className="admin-form-card admin-form-inline">
          <label>标题<input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          <label>正文<textarea value={body} onChange={(e) => setBody(e.target.value)} /></label>
          <label>级别<select value={level} onChange={(e) => setLevel(e.target.value)}><option value="info">信息</option><option value="success">成功</option><option value="warning">警告</option><option value="danger">紧急</option></select></label>
          <button className="primary-button" disabled={!title || !body} onClick={create}>发布</button>
        </div>
      </section>
      {error && <div className="operation-error">{error}</div>}
      <section className="admin-panel">
        <h3>公告列表</h3>
        <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>标题</th><th>正文</th><th>级别</th><th>状态</th><th>时间</th><th>操作</th></tr></thead><tbody>
          {data?.items?.map((item: any) => <tr key={item.id}><td>{item.title}</td><td className="admin-long-cell">{item.body}</td><td>{item.level}</td><td>{item.isActive ? '展示中' : '已下线'}</td><td className="mono">{new Date(item.createdAt).toLocaleString('zh-CN')}</td><td className="admin-row-actions"><button className="secondary-button" onClick={() => toggle(item)}>{item.isActive ? '下线' : '上线'}</button><button className="danger-button" onClick={() => remove(item)}>删除</button></td></tr>)}
        </tbody></table></div>
      </section>
    </div>
  );
}

const SETTINGS_DEFAULTS = {
  'site.branding': {
    appName: '奥术摸鱼大师',
    qqGroupNumber: '1087387691',
    qqGroupUrl: 'https://qm.qq.com/q/k83DCm1Zfi',
    supportEmail: '',
    icpRecord: '粤ICP备2026111521号',
    policeRecord: '粤公网安备44040202001962号',
  },
  'mail.smtp': {
    enabled: false,
    host: '',
    port: 465,
    secure: true,
    user: '',
    password: '',
    fromName: '奥术摸鱼大师',
    fromAddress: '',
    replyTo: '',
  },
  'security.registration': {
    allowRegistration: true,
    requireEmailVerification: true,
    requireAgreement: true,
  },
};

export function AdminSettingsTab({ toast }: { toast: Toast }) {
  const { data, error, reload } = useLoad<any>('/api/admin/settings');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [branding, setBranding] = useState<any>(SETTINGS_DEFAULTS['site.branding']);
  const [mail, setMail] = useState<any>(SETTINGS_DEFAULTS['mail.smtp']);
  const [registration, setRegistration] = useState<any>(SETTINGS_DEFAULTS['security.registration']);
  const [testRecipient, setTestRecipient] = useState('');
  const [testPending, setTestPending] = useState(false);
  useEffect(() => {
    if (!data?.items) return;
    setDrafts(Object.fromEntries(data.items.map((item: any) => [item.key, JSON.stringify(item.value)])));
    const map = new Map(data.items.map((item: any) => [item.key, item.value]));
    setBranding({ ...SETTINGS_DEFAULTS['site.branding'], ...(map.get('site.branding') as object || {}) });
    setMail({ ...SETTINGS_DEFAULTS['mail.smtp'], ...(map.get('mail.smtp') as object || {}) });
    setRegistration({ ...SETTINGS_DEFAULTS['security.registration'], ...(map.get('security.registration') as object || {}) });
  }, [data]);
  const save = async (key: string, value?: unknown) => {
    try {
      await apiPut(`/api/admin/settings/${encodeURIComponent(key)}`, { value: value ?? JSON.parse(drafts[key]) });
      toast(`${key} 已保存`);
      await reload();
    } catch (e: any) { toast(e.message); }
  };
  const saveStructured = async (key: keyof typeof SETTINGS_DEFAULTS, value: any) => {
    if (key === 'mail.smtp' && !String(value.password || '').trim()) {
      const current = data?.items?.find((item: any) => item.key === key)?.value;
      value = { ...value, password: current?.password || '' };
    }
    await save(key, value);
  };
  const sendTestMail = async () => {
    if (!testRecipient) return;
    setTestPending(true);
    try {
      await apiPost('/api/admin/mail/test', { to: testRecipient });
      toast('测试邮件已发送，请检查收件箱');
    } catch (e: any) { toast(`发送失败：${e.message}`); }
    finally { setTestPending(false); }
  };
  const knownKeys = new Set(Object.keys(SETTINGS_DEFAULTS));
  return (
    <div className="admin-panels">
      {error && <div className="operation-error">{error}</div>}
      <section className="admin-panel">
        <h3>站点与社区</h3>
        <p className="muted">这里的 QQ 群和备案信息会通过公开配置接口同步到玩家端。</p>
        <div className="admin-form-card" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(240px, 1fr))', gap: 12 }}>
          <label>游戏名称<input value={branding.appName ?? ''} onChange={(e) => setBranding({ ...branding, appName: e.target.value })} /></label>
          <label>客服邮箱<input type="email" value={branding.supportEmail ?? ''} onChange={(e) => setBranding({ ...branding, supportEmail: e.target.value })} /></label>
          <label>QQ 群号<input value={branding.qqGroupNumber ?? ''} onChange={(e) => setBranding({ ...branding, qqGroupNumber: e.target.value })} /></label>
          <label>QQ 群加入链接<input value={branding.qqGroupUrl ?? ''} onChange={(e) => setBranding({ ...branding, qqGroupUrl: e.target.value })} /></label>
          <label>ICP 备案号<input value={branding.icpRecord ?? ''} onChange={(e) => setBranding({ ...branding, icpRecord: e.target.value })} /></label>
          <label>公安备案号<input value={branding.policeRecord ?? ''} onChange={(e) => setBranding({ ...branding, policeRecord: e.target.value })} /></label>
        </div>
        <div className="admin-toolbar"><button className="primary-button" type="button" onClick={() => saveStructured('site.branding', branding)}>保存站点配置</button></div>
      </section>

      <section className="admin-panel">
        <h3>邮件服务</h3>
        <p className="muted">启用后，注册、找回密码和邮箱验证会通过 SMTP 发送验证码。密码只在管理员接口中读取。</p>
        <div className="admin-form-card" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(240px, 1fr))', gap: 12 }}>
          <label>启用 SMTP<select value={mail.enabled ? 'true' : 'false'} onChange={(e) => setMail({ ...mail, enabled: e.target.value === 'true' })}><option value="false">未启用</option><option value="true">已启用</option></select></label>
          <label>加密方式<select value={mail.secure ? 'true' : 'false'} onChange={(e) => setMail({ ...mail, secure: e.target.value === 'true' })}><option value="true">SSL/TLS（通常 465）</option><option value="false">STARTTLS（通常 587）</option></select></label>
          <label>SMTP 主机<input value={mail.host ?? ''} onChange={(e) => setMail({ ...mail, host: e.target.value })} placeholder="smtp.example.com" /></label>
          <label>端口<input type="number" value={mail.port ?? 465} onChange={(e) => setMail({ ...mail, port: Number(e.target.value) })} /></label>
          <label>SMTP 用户<input value={mail.user ?? ''} onChange={(e) => setMail({ ...mail, user: e.target.value })} /></label>
          <label>SMTP 密码<input type="password" value={mail.password ?? ''} onChange={(e) => setMail({ ...mail, password: e.target.value })} placeholder="留空则保留原密码" /></label>
          <label>发件人名称<input value={mail.fromName ?? ''} onChange={(e) => setMail({ ...mail, fromName: e.target.value })} /></label>
          <label>发件人地址<input type="email" value={mail.fromAddress ?? ''} onChange={(e) => setMail({ ...mail, fromAddress: e.target.value })} /></label>
          <label>回复地址<input type="email" value={mail.replyTo ?? ''} onChange={(e) => setMail({ ...mail, replyTo: e.target.value })} /></label>
        </div>
        <div className="admin-toolbar" style={{ marginTop: 12 }}>
          <button className="primary-button" type="button" onClick={() => saveStructured('mail.smtp', mail)}>保存邮件配置</button>
          <input type="email" placeholder="测试收件邮箱" value={testRecipient} onChange={(e) => setTestRecipient(e.target.value)} />
          <button className="secondary-button" type="button" disabled={!testRecipient || testPending} onClick={sendTestMail}>{testPending ? '发送中…' : '发送测试邮件'}</button>
        </div>
      </section>

      <section className="admin-panel">
        <h3>注册与验证</h3>
        <div className="admin-form-card" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(240px, 1fr))', gap: 12 }}>
          <label>允许新账号注册<select value={registration.allowRegistration ? 'true' : 'false'} onChange={(e) => setRegistration({ ...registration, allowRegistration: e.target.value === 'true' })}><option value="true">允许</option><option value="false">暂停注册</option></select></label>
          <label>注册必须邮箱验证<select value={registration.requireEmailVerification ? 'true' : 'false'} onChange={(e) => setRegistration({ ...registration, requireEmailVerification: e.target.value === 'true' })}><option value="true">必须验证</option><option value="false">可跳过</option></select></label>
          <label>必须同意用户协议<select value={registration.requireAgreement ? 'true' : 'false'} onChange={(e) => setRegistration({ ...registration, requireAgreement: e.target.value === 'true' })}><option value="true">必须同意</option><option value="false">可跳过</option></select></label>
        </div>
        <div className="admin-toolbar"><button className="primary-button" type="button" onClick={() => saveStructured('security.registration', registration)}>保存注册策略</button></div>
      </section>

      <section className="admin-panel">
        <h3>其他运行参数</h3>
        <div className="admin-settings-list">
          {data?.items?.filter((item: any) => !knownKeys.has(item.key)).map((item: any) => <div className="admin-setting-row" key={item.key}><div><b className="mono">{item.key}</b><small>值支持 JSON；对象和数组会原样保存。</small></div><input value={drafts[item.key] ?? ''} onChange={(e) => setDrafts({ ...drafts, [item.key]: e.target.value })} /><button className="primary-button" onClick={() => save(item.key)}>保存</button></div>)}
        </div>
      </section>
    </div>
  );
}

export function AdminMarketTab({ toast }: { toast: Toast }) {
  const { data, error, reload } = useLoad<any>('/api/admin/market/orders');
  const cancel = async (id: string) => { if (!window.confirm('撤销这笔市场订单？')) return; await apiPost(`/api/admin/market/orders/${id}/cancel`, {}); toast('订单已撤销'); await reload(); };
  return (
    <section className="admin-panel">
      <h3>市场订单</h3>
      {error && <div className="operation-error">{error}</div>}
      <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>玩家</th><th>资产</th><th>方向</th><th>价格</th><th>剩余</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead><tbody>
        {data?.items?.map((o: any) => <tr key={o.id}><td>{o.owner?.nickname ?? o.ownerId}</td><td>{o.fishId ?? o.gearId ?? o.itemType ?? o.assetType}</td><td>{o.side}</td><td className="gold-text mono">{fmt(o.limitUnitPrice)}</td><td>{fmt(o.remainingQuantity)}</td><td>{o.status}</td><td className="mono">{new Date(o.createdAt).toLocaleString('zh-CN')}</td><td>{o.status === 'active' && <button className="danger-button" onClick={() => cancel(o.id)}>撤销</button>}</td></tr>)}
      </tbody></table></div>
    </section>
  );
}

export function AdminSocialTab() {
  const { data, error } = useLoad<any>('/api/admin/social/overview');
  return (
    <div className="admin-panels">
      {error && <div className="operation-error">{error}</div>}
      <section className="admin-panel"><h3>公会</h3><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>公会</th><th>简称</th><th>等级</th><th>成员</th><th>资金</th><th>税率</th></tr></thead><tbody>
        {data?.guilds?.map((g: any) => <tr key={g.id}><td>{g.name}</td><td>[{g.tag}]</td><td>{g.level}</td><td>{g.memberCount}</td><td className="gold-text mono">{fmt(g.treasuryGold)}</td><td>{g.taxRatePercent}%</td></tr>)}
      </tbody></table></div></section>
      <section className="admin-panel"><h3>组队船</h3><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>船只</th><th>地图</th><th>状态</th><th>公开性</th><th>资金</th><th>创建时间</th></tr></thead><tbody>
        {data?.boats?.map((b: any) => <tr key={b.id}><td>{b.name}</td><td>{b.biomeId}</td><td>{b.status}</td><td>{b.visibility}</td><td className="gold-text mono">{fmt(b.treasuryGold)}</td><td className="mono">{new Date(b.createdAt).toLocaleString('zh-CN')}</td></tr>)}
      </tbody></table></div></section>
    </div>
  );
}

export function AdminAuditTab() {
  const { data, error } = useLoad<any>('/api/admin/audit?limit=300');
  return (
    <section className="admin-panel">
      <h3>操作审计</h3>
      {error && <div className="operation-error">{error}</div>}
      <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>时间</th><th>管理员</th><th>动作</th><th>对象</th><th>详情</th></tr></thead><tbody>
        {data?.items?.map((row: any) => <tr key={row.id}><td className="mono">{new Date(row.createdAt).toLocaleString('zh-CN')}</td><td>{row.actor}</td><td className="mono">{row.action}</td><td className="mono">{row.targetType}{row.targetId ? `:${row.targetId}` : ''}</td><td className="admin-long-cell">{JSON.stringify(row.details)}</td></tr>)}
      </tbody></table></div>
    </section>
  );
}
