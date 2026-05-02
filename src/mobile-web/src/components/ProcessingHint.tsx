/**
 * Mobile-web equivalent of the desktop ProcessingIndicator.
 * Shows the IgnitionDot (animated) + rotating fun hint text while AI is working.
 * Mirrors the desktop's 1s delay, 5s rotation, and fade-breathe animation.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import IgnitionDot from './IgnitionDot';
import './ProcessingHint.scss';

// ─── Fun hint text arrays (same as desktop processingHints.ts) ───────────────

const processingHintsZh: string[] = [
  '思维回路全速运转...',
  'Token 们奋力排列中...',
  '矩阵乘法进行中...',
  'Transformer 全力变形...',
  '最后一次梯度下降...',
  '注意力机制已锁定...',
  '思维发动机轰鸣启动...',
  '激活函数全员上岗...',
  '推理链跑起来了...',
  '十四亿参数找答案...',
  '上下文窗口挤一挤...',
  '最合适的词正在出现...',
  '正在 Debug 思维链...',
  '在语言的岔路口选方向...',
  '给神经网络倒咖啡...',
  '模型正在思考人生...',
  '神经元群情激昂...',
  '正在召开内部评审会...',
  '多个思路正在 PK...',
  '答案在路上了...',
  '拼图最后一块到位...',
  '差不多了，收尾中...',
  '还差一点点...',
  '就差临门一脚...',
  '搞定了百分之九十九...',
  '答案正在着陆跑道...',
  '翻阅无数可能中...',
  '脑洞已打开...',
  '在知识图谱里找路...',
  '知识正在快速结晶...',
  '字斟句酌，只给精华...',
  '想想，再想想...',
  '这道题，我会！',
  '收到！全力处理中...',
  '全情投入，心无旁骛...',
  '才华正在集中爆发...',
  '正在憋大招...',
  '超强输出，即将到来...',
  '最强答案正在成形...',
  '把散落的灵感拼起来...',
  '脑内灯泡闪烁中...',
  '思路打结，解开中...',
  '秒速百公里地思考...',
  '知识储备调用中...',
  '智慧内核全速转...',
  '脑子已经全力转起来了...',
  '正在为你量身定制...',
  '把最好的留到最后...',
  '用心对待每一个字...',
  '注意力全给你了...',
  '这一刻，全给你...',
  '混沌转逻辑中...',
  '思考齿轮咬合中...',
  '合并所有子思路...',
  '拆解成千个小问题...',
  '千个念头取最好...',
  '整理千头万绪中...',
  '确认答案合理性中...',
  '把模糊变清晰中...',
  '思维正在对焦...',
  '全速冲刺，答案在望...',
  '思维扩容，装下更多...',
  '逻辑拼图已完成...',
  '有条不紊，稳步推进...',
  '万事就绪，答案出发...',
  '思路刚打通，马上来...',
  '用推理缝合碎片...',
  '召开紧急大脑会议...',
  '整理出最佳路径...',
  '正在审阅自己的思维...',
  '努力中，绝不放弃...',
  '正在做些不可思议的事...',
  '我在，我想，我输出...',
  '正在奋笔疾书...',
  '正在将想法变为现实...',
  '知识全力驰援中...',
  '删删改改中...',
  '比特们正在排队...',
  '思维启动加速度...',
  '正在给回答注入灵魂...',
  '准备好了吗？快了...',
  '就差最后一步...',
  '答案即将成形...',
  '正在快乐工作中...',
  '大脑正在全速燃烧...',
  '正在把复杂变简单...',
  '知识海洋里捞最优解...',
  '答案正在破壳而出...',
  '大招正在蓄力中...',
  '答案即将横空出世...',
];

const processingHintsEn: string[] = [
  'Neural circuits running at full speed...',
  'Tokens lining up in perfect order...',
  'Matrix multiplications in progress...',
  'One final gradient descent to go...',
  'Attention heads: activated and locked...',
  'Thought engine roaring to life...',
  'Activation functions reporting for duty...',
  'Reasoning chain is running...',
  'Spelunking through fourteen billion parameters...',
  'Squeezing into the context window...',
  'The perfect word is surfacing...',
  'Debugging my own chain of thought...',
  'Picking a path through the language labyrinth...',
  'Feeding the model its morning coffee...',
  'Neurons firing in passionate debate...',
  'Holding an internal peer review...',
  'Multiple ideas in a heated competition...',
  'Answer is on its way...',
  'Last puzzle piece sliding into place...',
  'Almost done, wrapping up...',
  'Just a tiny bit more...',
  'One final push to go...',
  'Ninety-nine percent done...',
  'Answer on final approach for landing...',
  'Rummaging through the multiverse of ideas...',
  'Navigating the knowledge graph...',
  'Knowledge crystallizing rapidly...',
  'Hand-picking only the best words...',
  'Let me think... still thinking...',
  'I know this one!',
  'Roger that! Processing at full capacity...',
  'Fully in the zone right now...',
  'Talent concentrated and detonating...',
  'Charging up the big move...',
  'Supercharged output incoming...',
  'The best answer is taking shape...',
  'Lightbulb flickering in the back of my mind...',
  'Untangling the knots in my reasoning...',
  'Thinking at hundreds of miles per second...',
  'Pulling from deep knowledge reserves...',
  'Brain already spinning at full tilt...',
  'Tailoring this response just for you...',
  'Crafting every word with care...',
  'All attention given to you...',
  'This moment is entirely for you...',
  'Converting chaos into logic...',
  'Gears of thought clicking into place...',
  'Breaking it into a thousand micro-problems...',
  'Picking the best of a thousand thoughts...',
  'Sorting through a tangle of threads...',
  'Turning fuzzy into clear...',
  'Thoughts coming into focus...',
  'Sprinting to the finish line...',
  'Logic puzzle: assembled...',
  'Moving steadily, step by step...',
  'Thread of thought just clicked — almost there...',
  'Stitching the fragments together with reasoning...',
  'Calling an emergency brain session...',
  'Pushing through, won\'t give up...',
  'Doing something kind of amazing right now...',
  'I think, therefore I output...',
  'Writing at full speed...',
  'Turning ideas into reality...',
  'Editing and re-editing...',
  'Bits falling into line...',
  'Thought engine accelerating...',
  'Infusing the response with soul...',
  'Almost there...',
  'One last step to go...',
  'Answer taking shape...',
  'Happily working away...',
  'Brain burning at full speed...',
  'Turning complexity into simplicity...',
  'Optimal path: locked in...',
  'Creating something from nothing, just for you...',
  'Answer hatching right now...',
];

// ────────────────────────────────────────────────────────────────────────────

interface ProcessingHintProps {
  visible: boolean;
}

const ProcessingHint: React.FC<ProcessingHintProps> = ({ visible }) => {
  const { language } = useI18n();
  const hints = language.startsWith('zh') ? processingHintsZh : processingHintsEn;

  const [showHint, setShowHint] = useState(false);
  const [hintIndex, setHintIndex] = useState(0);

  const delayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rotateTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (visible) {
      const initialIndex = Math.floor(Math.random() * hints.length);
      setHintIndex(initialIndex);

      delayTimerRef.current = setTimeout(() => {
        setShowHint(true);
        rotateTimerRef.current = setInterval(() => {
          setHintIndex(prev => (prev + 1) % hints.length);
        }, 5000);
      }, 1000);
    } else {
      if (delayTimerRef.current) {
        clearTimeout(delayTimerRef.current);
        delayTimerRef.current = null;
      }
      if (rotateTimerRef.current) {
        clearInterval(rotateTimerRef.current);
        rotateTimerRef.current = null;
      }
      setShowHint(false);
    }

    return () => {
      if (delayTimerRef.current) clearTimeout(delayTimerRef.current);
      if (rotateTimerRef.current) clearInterval(rotateTimerRef.current);
    };
  }, [visible, hints.length]);

  if (!visible && !showHint) return null;

  return (
    <div className="processing-hint" aria-hidden={!visible}>
      <div
        className="processing-hint__content"
        style={visible ? undefined : { visibility: 'hidden' as const }}
      >
        {showHint && hints.length > 0 && (
          <>
            <IgnitionDot pulsing size="sm" className="processing-hint__dot" />
            <span key={hintIndex} className="processing-hint__text">
              {hints[hintIndex]}
            </span>
          </>
        )}
        {!showHint && visible && (
          <div className="processing-hint__typing">
            <span /><span /><span />
          </div>
        )}
      </div>
    </div>
  );
};

export default ProcessingHint;
