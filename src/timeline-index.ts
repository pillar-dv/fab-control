export function upperBound<T>(items:readonly T[],time:number,at:(item:T)=>number){
  let first=0,end=items.length;
  while(first<end){
    const middle=(first+end)>>>1;
    if(at(items[middle])<=time)first=middle+1;
    else end=middle;
  }
  return first;
}

export function intervalIndex<T extends {start:number;end:number}>(items:readonly T[]){
  const sorted=[...items].sort((a,b)=>a.start-b.start);
  const maxEnd:number[]=[];
  for(const [index,item] of sorted.entries())maxEnd.push(Math.max(item.end,maxEnd[index-1]??-Infinity));
  return (time:number)=>{
    const first=upperBound(maxEnd,time,end=>end),end=upperBound(sorted,time,item=>item.start);
    return sorted.slice(first,end).filter(item=>item.end>time);
  };
}
