/** Remove only a strongly established, sequential manuscript margin-number column. */
export function manuscriptReadingText(text:string) {
  const lines=text.split('\n');
  const numbered=lines.flatMap((line,index)=>{
    const match=/^[ \t]{0,3}(\d{1,5})(?:[ \t]+(.*))?$/.exec(line.replace(/\f/g,''));
    return match?[{index,number:Number(match[1]),content:match[2]||''}]:[];
  });
  const sequential=numbered.slice(1).filter((line,index)=>line.number===numbered[index].number+1).length;
  const prose=numbered.filter(line=>/\p{L}{2,}.*\p{L}{2,}/u.test(line.content)).length;
  if(numbered.length<50||numbered.length<lines.filter(line=>line.trim()).length/2||prose/numbered.length<0.6||sequential/(numbered.length-1)<0.9)return {text,removed:0};
  let removed=0;
  for(const [index,line] of numbered.entries()) {
    if(numbered[index-1]?.number===line.number-1||numbered[index+1]?.number===line.number+1){lines[line.index]=line.content;removed++;}
  }
  return {text:lines.join('\n'),removed};
}
