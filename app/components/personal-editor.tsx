import type { ScoreSet } from "../data/games";
import { averageScore, libraryLabels, scoreAxes, type LibraryStatus } from "../lib/catalog";
export function PersonalEditor({status,onStatus,scores,onScores,notes,onNotes,expectation,onExpectation,reviewConfirmed,onReview,disabled,saved,hasEntry}: {
  status:LibraryStatus;onStatus:(v:LibraryStatus)=>void;scores:Partial<ScoreSet>;onScores:(v:Partial<ScoreSet>)=>void;notes:string;onNotes:(v:string)=>void;expectation?:number;onExpectation:(v:number|undefined)=>void;reviewConfirmed:boolean;onReview:(v:boolean)=>void;disabled:boolean;saved:boolean;hasEntry:boolean;
}) {
  const average=averageScore(scores);
  return <section className="personal-editor"><div className="section-heading"><h2>我的游玩记录</h2><span>{saved?"已保存":hasEntry?"已在游戏架":"尚未收藏"}</span></div>
    <fieldset disabled={disabled} className="editor-fields"><legend className="sr-only">个人记录</legend><div className="shelf-choices" role="group" aria-label="游玩状态">{Object.entries(libraryLabels).map(([value,label])=><button key={value} className={status===value?"active":""} aria-pressed={status===value} onClick={()=>onStatus(value as LibraryStatus)}>{label}</button>)}</div>
    <label className="expectation-field">期待程度<select value={expectation??""} onChange={e=>onExpectation(e.target.value?Number(e.target.value):undefined)}><option value="">未设置</option>{["随缘看看","有点兴趣","值得关注","很想玩","必玩清单"].map((label,i)=><option key={label} value={i+1}>{i+1} / 5 · {label}</option>)}</select></label><p className="muted">期待不等于体验评分，不参与评分排序。</p>
    <div className="section-heading"><h3>实际体验 · 四维评价</h3><span>{reviewConfirmed&&average!==null?`均值 ${average.toFixed(1)} / 10`:"未评分"}</span></div><label className="review-consent"><input type="checkbox" checked={reviewConfirmed} onChange={e=>onReview(e.target.checked)}/>我已实际体验这款游戏（含试玩），以下是体验评价</label>
    {!reviewConfirmed&&average!==null&&<p className="notice">旧版评分仍完整保留，但暂不参与体验评分排序。确认实际体验后启用；不会自动转换为期待值。</p>}
    {reviewConfirmed&&<div className="score-editor">{scoreAxes.map(({key,label})=><label className="score-select" key={key}>{label}<select aria-label={`${label}评分`} value={scores[key]??""} onChange={e=>{const next={...scores};if(e.target.value)next[key]=Number(e.target.value);else delete next[key];onScores(next);}}><option value="">未评分</option>{Array.from({length:19},(_,i)=>1+i*.5).map(n=><option key={n} value={n}>{n} / 10</option>)}</select></label>)}</div>}
    <label className="notes-label"><span>私人笔记</span><textarea maxLength={5000} rows={4} value={notes} onChange={e=>onNotes(e.target.value)} placeholder="想玩的理由、游玩进度、剧情感想……"/><small>{notes.length} / 5000</small></label></fieldset></section>;
}
