"""Fail-closed comparison of complete Vue coverage runs from one frozen source."""
import argparse,collections,json,os,pathlib

def read(path):return json.loads(path.read_text())
def compare(root,expected):
    bad=[key for key,value in json.loads(os.environ.get('CI_BENCH_NEEDS','{}')).items()if value.get('result')!='success']
    if bad:raise ValueError('Unsuccessful prerequisites: '+', '.join(bad))
    metrics={}
    for file in root.rglob('metric-vue-*.json'):
        metric=read(file);label=metric['label']
        if label in metrics:raise ValueError('Duplicate result: '+label)
        metrics[label]=(file.parent,metric)
    reference=None;rows=[]
    for label in expected:
        if label not in metrics:raise ValueError('Missing result: '+label)
        folder,metric=metrics[label]
        if metric['exit_code']!=0:raise ValueError('Failed command: '+label)
        source=read(folder/'source.json');tests=read(folder/'tests.json');coverage=read(folder/'coverage/coverage-final.json')
        if not tests['success']or tests['numFailedTests']:raise ValueError('Failed tests: '+label)
        base=pathlib.Path(source['root']);relative=lambda path:str(pathlib.Path(path).relative_to(base))
        inventory=collections.Counter((relative(file['name']),case['fullName'],case['status'])for file in tests['testResults']for case in file['assertionResults'])
        if not inventory:raise ValueError('Empty test inventory: '+label)
        if not coverage:raise ValueError('Empty coverage: '+label)
        maps={relative(file):{field:item[field]for field in ['statementMap','fnMap','branchMap']}for file,item in coverage.items()}
        counts=[count for item in coverage.values()for count in item['s'].values()];covered=sum(count>0 for count in counts)
        if not counts or covered/len(counts)<.85:raise ValueError('Statement coverage below 85%: '+label)
        current=(source['sha'],inventory,maps)
        if reference is None:reference=current
        elif current!=reference:raise ValueError('Source, tests, or coverage instrumentation differ: '+label)
        rows.append({'label':label,'sha':source['sha'],'elapsed_seconds':metric['elapsed_seconds'],'peak_tree_rss_bytes':metric['peak_tree_rss_bytes'],'logical_cpus':metric['logical_cpus'],'test_cases':sum(inventory.values()),'test_files':len(tests['testResults']),'coverage_files':len(maps),'statements':{'covered':covered,'total':len(counts),'percent':100*covered/len(counts)},'variant':source['variant']})
    result={'result':'matching source, exact test cases and full coverage instrumentation; every run passes 85% statements','runs':rows}
    (root/'vue-performance-summary.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--input',type=pathlib.Path,required=True);p.add_argument('--expect',action='append',required=True);a=p.parse_args();compare(a.input,a.expect)
